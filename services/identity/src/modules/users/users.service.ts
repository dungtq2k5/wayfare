import { Injectable } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  IDENTITY_USER_ERASED,
  LegalDocument,
  LegalParty,
  MAX_FULL_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_POLICY_VERSION_LENGTH,
  normalizeText,
  SessionRevokedReason,
  zLanguage,
} from '@wayfare/contracts';
import { legalDocumentProto, legalPartyProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import {
  deviceIdOf,
  OutboxService,
  parseRpcRequest,
  requireProtoEnum,
  requireAccountContext,
  rpcError,
} from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import { AccessService } from '../access/access.service';
import { AccountLinksService } from '../account-links/account-links.service';
import { auditRecord } from '../audit/domain/audit-record';
import { BillingPortService } from '../billing-port/billing-port.service';
import { DevicesService } from '../devices/devices.service';
import { LegalService } from '../legal/legal.service';
import { OwnerRegistrationsService } from '../owner-registrations/owner-registrations.service';
import type { LegalPartyRef } from '../legal/legal.service';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_ACCOUNT_SELECT, SessionsService } from '../sessions/sessions.service';
import type { SessionAccount } from '../sessions/sessions.service';
import { TokensService } from '../tokens/tokens.service';
import { erasedEmail } from './domain/account-state';
import { toLegalAcceptance, toSessionUser } from './user.mapper';

const updateMeFields = z
  .object({
    fullName: z
      .string()
      .transform(normalizeText)
      .pipe(z.string().min(1).max(MAX_FULL_NAME_LENGTH))
      .optional(),
    preferredLocale: zLanguage.optional(),
  })
  .strict();

const acceptanceFields = z.object({ version: z.string().min(1).max(MAX_POLICY_VERSION_LENGTH) });

const eraseFields = z.object({ currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH) });

/** The caller's own account (api-endpoints-plan §1.3, rdm-spec I-1, I-12). */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly legal: LegalService,
    private readonly devices: DevicesService,
    private readonly registrations: OwnerRegistrationsService,
    private readonly outbox: OutboxService,
    private readonly tokens: TokensService,
    private readonly sessions: SessionsService,
    private readonly links: AccountLinksService,
    private readonly billing: BillingPortService,
  ) {}

  /**
   * The console's bootstrap read — from the database, not the token. `owner` is there for a verified
   * owner or an applicant, with the open application when there is one.
   */
  async getMe(context: RequestContext): Promise<identityGrpc.GetMeResponse> {
    const account = requireAccountContext(context);
    return this.prisma.$transaction(async (tx) => {
      const user = await this.liveUser(tx, account.userId);
      const { roles, permissions } = await this.access.accessOf(tx, user.id);
      const ownerVerified = user.ownerVerifiedAt !== null;
      const pendingRegistration = await this.registrations.pendingFor(tx, user.id);
      return {
        user: toSessionUser(user),
        roles,
        permissions,
        ownerVerified,
        owner:
          ownerVerified || pendingRegistration !== undefined ? { pendingRegistration } : undefined,
      };
    });
  }

  /** Edits the name and the UI language only. Nothing is defaulted; no audit row (api §1.3). */
  async updateMe(
    request: identityGrpc.UpdateMeRequest,
    context: RequestContext,
  ): Promise<identityGrpc.UpdateMeResponse> {
    const account = requireAccountContext(context);
    const fields = parseRpcRequest(updateMeFields, request);
    const user = await this.prisma.$transaction(async (tx) => {
      await this.liveUser(tx, account.userId);
      return tx.user.update({
        where: { id: account.userId },
        data: {
          ...(fields.fullName === undefined ? {} : { fullName: fields.fullName }),
          ...(fields.preferredLocale === undefined
            ? {}
            : { preferredLocale: fields.preferredLocale }),
        },
        select: SESSION_ACCOUNT_SELECT,
      });
    });
    return { user: toSessionUser(user) };
  }

  /** The newest acceptance per document for the account and, when present, the calling device. */
  async listLegalAcceptances(
    context: RequestContext,
  ): Promise<identityGrpc.ListLegalAcceptancesResponse> {
    const account = requireAccountContext(context);
    const parties: LegalPartyRef[] = [{ party: LegalParty.USER, userId: account.userId }];
    if (account.deviceId !== null)
      parties.push({ party: LegalParty.DEVICE, deviceId: account.deviceId });
    const views = await this.prisma.$transaction((tx) => this.legal.latest(tx, parties));
    return { acceptances: views.map(toLegalAcceptance) };
  }

  /** Records a current acceptance for the account, or for the calling device once it is known to be live. */
  async recordLegalAcceptance(
    request: identityGrpc.RecordLegalAcceptanceRequest,
    context: RequestContext,
  ): Promise<identityGrpc.RecordLegalAcceptanceResponse> {
    const party = requireProtoEnum(legalPartyProto, request.party, '/party');
    const document: LegalDocument = requireProtoEnum(
      legalDocumentProto,
      request.document,
      '/document',
    );
    const { version } = parseRpcRequest(acceptanceFields, request);
    const view = await this.prisma.$transaction(async (tx) => {
      if (party === LegalParty.USER) {
        const account = requireAccountContext(context);
        return this.legal.record(
          tx,
          { party, userId: account.userId },
          document,
          version,
          context.origin.ip,
        );
      }
      const deviceId = deviceIdOf(context);
      if (deviceId === null) throw rpcError('UNAUTHENTICATED');
      await this.devices.requireLiveDevice(tx, deviceId);
      return this.legal.record(tx, { party, deviceId }, document, version, context.origin.ip);
    });
    return { acceptance: toLegalAcceptance(view) };
  }

  /**
   * Erasure (api-endpoints-plan §1.3, rdm-spec I-1): the password, then billing's check — a remote
   * call cannot sit inside the transaction, and billing's answer cannot change through identity in
   * between — then, under the super-admin lock when the caller holds that role and the user row's,
   * identity's own conditions and the erasure itself, in one transaction. A second call that lost
   * the race finds the account erased and writes nothing.
   */
  async eraseMe(
    request: identityGrpc.EraseMeRequest,
    context: RequestContext,
  ): Promise<identityGrpc.EraseMeResponse> {
    const account = requireAccountContext(context);
    const { currentPassword } = parseRpcRequest(eraseFields, request);
    const user = await this.prisma.user.findFirst({
      where: { id: account.userId, deletedAt: null },
      select: { id: true, passwordHash: true },
    });
    if (user === null) throw rpcError('UNAUTHENTICATED');
    if (!(await this.tokens.verifyPassword(user.passwordHash, currentPassword))) {
      throw rpcError('INVALID_CREDENTIALS');
    }
    const blockers = await this.billing.getErasureBlockers(user.id);
    if (blockers.pendingBuyerOrder) throw rpcError('BUYER_HAS_PENDING_ORDER');
    if (
      blockers.activeSubscription ||
      blockers.issuedVouchersSold > 0 ||
      blockers.openDisputes > 0
    ) {
      throw rpcError(
        'OWNER_HAS_ACTIVE_OBLIGATIONS',
        blockers.subscriptionEndsAt === null
          ? {}
          : { subscriptionEndsAt: blockers.subscriptionEndsAt.toISOString() },
      );
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // The same order as an admin's deactivation: the super-admin lock, then the user row.
      const superAdmin = await this.access.holdsSuperAdmin(tx, user.id);
      if (superAdmin) await this.access.lockSuperAdmins(tx);
      const [row] = await tx.$queryRaw<{ deleted_at: Date | null; erased_at: Date | null }[]>`
        SELECT deleted_at, erased_at FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
      if (row?.erased_at != null) return;
      if (row?.deleted_at !== null) throw rpcError('UNAUTHENTICATED');
      if (await this.links.liveRevertFor(tx, { userId: user.id })) {
        throw rpcError('EMAIL_CHANGE_REVERT_PENDING');
      }
      if (superAdmin) {
        await this.access.requireSuperAdminRemains(tx, { kind: 'ERASE', userId: user.id }, now);
      }
      await this.erase(tx, user.id, context, now);
    });
    return {};
  }

  /** Everything erasure changes in identity (rdm-spec I-1), ending with the audit row and the event. */
  private async erase(
    tx: Prisma.TransactionClient,
    userId: string,
    context: RequestContext,
    now: Date,
  ): Promise<void> {
    await tx.user.update({
      where: { id: userId },
      data: {
        email: erasedEmail(userId),
        passwordHash: null,
        fullName: null,
        isEmailVerified: false,
        emailBouncedAt: null,
        deletedAt: now,
        erasedAt: now,
      },
      select: { id: true },
    });
    await this.sessions.revokeAllForUser(tx, userId, SessionRevokedReason.ERASED, {
      bumpCutoff: true,
      now,
    });
    await tx.session.updateMany({ where: { userId }, data: { ip: null, userAgent: null } });
    // The push token is the phone's, not the person's.
    await tx.device.updateMany({ where: { userId }, data: { userId: null, claimedAt: null } });
    await tx.actionToken.deleteMany({ where: { userId } });
    await tx.notification.deleteMany({ where: { recipientUserId: userId } });
    await tx.emailDelivery.updateMany({
      where: { recipientUserId: userId },
      data: { toEmailMasked: null, toEmailHash: null },
    });
    await this.registrations.eraseFor(tx, userId, now, context.origin);
    await this.outbox.add(
      tx,
      AUDIT_RECORD,
      auditRecord({
        actor: { type: AuditActorType.USER, userId },
        action: AuditAction.USER_ERASED,
        resource: { type: AuditResourceType.USER, id: userId },
        metadata: {},
        origin: context.origin,
        now,
      }),
    );
    await this.outbox.add(tx, IDENTITY_USER_ERASED, { occurredAt: now.toISOString(), userId });
  }

  /** The caller's account; a deactivated or missing one is `UNAUTHENTICATED`. */
  private async liveUser(tx: Prisma.TransactionClient, userId: string): Promise<SessionAccount> {
    const user = await tx.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: SESSION_ACCOUNT_SELECT,
    });
    if (user === null) throw rpcError('UNAUTHENTICATED');
    return user;
  }
}
