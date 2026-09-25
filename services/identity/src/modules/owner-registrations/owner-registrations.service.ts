import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  LegalDocument,
  OwnerRegistrationStatus,
  parseEnum,
  zCursorQuery,
  zOwnerRegistrationInput,
  zUuidV7,
} from '@wayfare/contracts';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import {
  decodeCursor,
  encodeCursor,
  encryptPii,
  isUniqueConstraintViolation,
  OutboxService,
  parseRpcRequest,
  piiLast4,
  requireAccountContext,
  rpcError,
} from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import type { Env } from '../../config/env.schema';
import { auditRecord } from '../audit/domain/audit-record';
import type { AuditFacts, AuditOrigin } from '../audit/domain/audit-record';
import { LegalService } from '../legal/legal.service';
import { PrismaService } from '../prisma/prisma.service';
import { canTransition } from './domain/registration-status';
import {
  OWNER_REGISTRATION_SELECT,
  toOwnerRegistration,
  toPendingRegistration,
} from './owner-registration.mapper';

const PENDING: string = OwnerRegistrationStatus.PENDING;

const withdrawFields = z.object({ registrationId: zUuidV7 });
const ownerVerificationFields = z.object({ userId: zUuidV7 });
const listVerifiedOwnerIdsFields = z.object({ page: zCursorQuery });

/** What erasure's step reports. */
export interface RegistrationErasure {
  readonly withdrawn: number;
  readonly cleared: number;
}

/** The applicant's row, locked for the application (rdm-spec I-1, I-8). */
interface ApplicantLockRow {
  readonly is_email_verified: boolean;
  readonly owner_verified_at: Date | null;
  readonly deleted_at: Date | null;
}

/** Proto3 `optional` strings may arrive as `null`; the schema reads absent as `undefined`. */
function present<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

/**
 * The applicant's side of owner verification (api-endpoints-plan §1.4, rdm-spec I-8). The national
 * ID is encrypted before the row is written; the plaintext never leaves `submitRegistration`.
 */
@Injectable()
export class OwnerRegistrationsService {
  private readonly piiKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly legal: LegalService,
    config: ConfigService<Env, true>,
  ) {
    this.piiKey = config.get('PII_ENCRYPTION_KEY', { infer: true });
  }

  /**
   * Applies. One user's applications run one at a time on their locked row, so the checks, the
   * agreement's acceptance and the insert are one serial step; the partial unique index is the
   * backstop. `fixed` is the development seed's committed id (ADR 0002), never reachable over gRPC.
   */
  async submitRegistration(
    request: identityGrpc.SubmitRegistrationRequest,
    context: RequestContext,
    fixed: { readonly id?: string } = {},
  ): Promise<identityGrpc.SubmitRegistrationResponse> {
    const account = requireAccountContext(context);
    const input = parseRpcRequest(zOwnerRegistrationInput, {
      businessName: request.businessName,
      businessAddress: request.businessAddress,
      businessRegistrationNo: present(request.businessRegistrationNo),
      contactName: request.contactName,
      contactPhone: request.contactPhone,
      nationalId: request.nationalId,
      applicantNote: present(request.applicantNote),
      ownerAgreementVersion: request.ownerAgreementVersion,
    });
    const now = new Date();
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const [applicant] = await tx.$queryRaw<ApplicantLockRow[]>`
          SELECT is_email_verified, owner_verified_at, deleted_at
          FROM users WHERE id = ${account.userId}::uuid
          FOR UPDATE`;
        if (applicant?.deleted_at !== null) {
          throw rpcError('UNAUTHENTICATED');
        }
        if (!applicant.is_email_verified) throw rpcError('EMAIL_NOT_VERIFIED');
        if (applicant.owner_verified_at !== null) {
          throw rpcError('INVALID_STATE', { status: 'ALREADY_OWNER' });
        }
        const open = await tx.ownerRegistration.findFirst({
          where: { userId: account.userId, status: PENDING },
          select: { id: true },
        });
        if (open !== null) throw rpcError('REGISTRATION_ALREADY_PENDING');
        await this.legal.acceptIfMissing(
          tx,
          account.userId,
          LegalDocument.OWNER_AGREEMENT,
          input.ownerAgreementVersion,
          account.origin.ip,
        );
        const created = await tx.ownerRegistration.create({
          data: {
            ...(fixed.id === undefined ? {} : { id: fixed.id }),
            userId: account.userId,
            status: PENDING,
            businessName: input.businessName,
            businessAddress: input.businessAddress,
            businessRegistrationNo: input.businessRegistrationNo ?? null,
            contactName: input.contactName,
            contactPhone: input.contactPhone,
            nationalIdCiphertext: encryptPii(this.piiKey, input.nationalId),
            nationalIdLast4: piiLast4(input.nationalId),
            applicantNote: input.applicantNote ?? null,
            submittedAt: now,
          },
          select: OWNER_REGISTRATION_SELECT,
        });
        await this.audit(tx, account, AuditAction.OWNER_REGISTRATION_SUBMITTED, created.id, now, {
          after: { status: PENDING },
        });
        return created;
      });
      return { registration: toOwnerRegistration(row) };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) throw rpcError('REGISTRATION_ALREADY_PENDING');
      throw error;
    }
  }

  /** The caller's applications, newest first. */
  async listMyRegistrations(
    context: RequestContext,
  ): Promise<identityGrpc.ListMyRegistrationsResponse> {
    const account = requireAccountContext(context);
    const rows = await this.prisma.ownerRegistration.findMany({
      where: { userId: account.userId },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      select: OWNER_REGISTRATION_SELECT,
    });
    return { registrations: rows.map(toOwnerRegistration) };
  }

  /** `PENDING` → `WITHDRAWN` on the caller's own row; anyone else's is not found. */
  async withdrawRegistration(
    request: identityGrpc.WithdrawRegistrationRequest,
    context: RequestContext,
  ): Promise<identityGrpc.WithdrawRegistrationResponse> {
    const account = requireAccountContext(context);
    const { registrationId } = parseRpcRequest(withdrawFields, request);
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.ownerRegistration.findFirst({
        where: { id: registrationId, userId: account.userId },
        select: { status: true },
      });
      if (current === null)
        throw rpcError('RESOURCE_NOT_FOUND', { resource: 'OWNER_REGISTRATION' });
      const from = parseEnum(OwnerRegistrationStatus, current.status);
      const moved = canTransition(from, OwnerRegistrationStatus.WITHDRAWN)
        ? await tx.ownerRegistration.updateMany({
            where: { id: registrationId, status: PENDING },
            data: { status: OwnerRegistrationStatus.WITHDRAWN },
          })
        : { count: 0 };
      if (moved.count === 0) {
        const latest = await tx.ownerRegistration.findUniqueOrThrow({
          where: { id: registrationId },
          select: { status: true },
        });
        throw rpcError('INVALID_STATE', { status: latest.status });
      }
      await this.audit(tx, account, AuditAction.OWNER_REGISTRATION_WITHDRAWN, registrationId, now, {
        before: { status: PENDING },
      });
      return tx.ownerRegistration.findUniqueOrThrow({
        where: { id: registrationId },
        select: OWNER_REGISTRATION_SELECT,
      });
    });
    return { registration: toOwnerRegistration(row) };
  }

  /**
   * Whether an owner is still verified and live (api-endpoints-plan §12.2): catalog asks on every
   * approval that writes a Venue's owner, since the token claim was true when the owner submitted
   * and may not be now. Internal, answered for any caller context. An unknown id is neither.
   */
  async getOwnerVerification(
    request: identityGrpc.GetOwnerVerificationRequest,
  ): Promise<identityGrpc.GetOwnerVerificationResponse> {
    const { userId } = parseRpcRequest(ownerVerificationFields, request);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ownerVerifiedAt: true, deletedAt: true, erasedAt: true },
    });
    return {
      verified: user?.ownerVerifiedAt != null,
      live: user?.deletedAt === null && user.erasedAt === null,
    };
  }

  /**
   * Live, verified owner ids, keyset-paged on the id (api-endpoints-plan §12.2): billing's daily
   * reconcile pages every one, opening a `FREE` account for any id with none — the guarantee
   * behind `identity.owner.verified`, whose stream a retention window can outlive. Internal,
   * answered for any caller context.
   */
  async listVerifiedOwnerIds(
    request: identityGrpc.ListVerifiedOwnerIdsRequest,
  ): Promise<identityGrpc.ListVerifiedOwnerIdsResponse> {
    const { page } = parseRpcRequest(listVerifiedOwnerIdsFields, request);
    const after = page.cursor === undefined ? null : decodeCursor(page.cursor);
    if (page.cursor !== undefined && after === null) {
      throw rpcError('VALIDATION_FAILED', {
        issues: [{ path: '/page/cursor', code: 'invalid_format' }],
      });
    }
    const rows = await this.prisma.user.findMany({
      where: {
        ownerVerifiedAt: { not: null },
        deletedAt: null,
        erasedAt: null,
        ...(after === null ? {} : { id: { gt: after.id } }),
      },
      orderBy: { id: 'asc' },
      take: page.limit + 1,
      select: { id: true },
    });
    const ids = rows.slice(0, page.limit);
    const last = ids.at(-1);
    return {
      ownerUserIds: ids.map((row) => row.id),
      page:
        rows.length > page.limit && last !== undefined
          ? { nextCursor: encodeCursor({ id: last.id }) }
          : {},
    };
  }

  /** `/users/me`'s `owner.pendingRegistration`: the caller's open application, when there is one. */
  async pendingFor(
    db: Prisma.TransactionClient,
    userId: string,
  ): Promise<identityGrpc.PendingRegistration | undefined> {
    const row = await db.ownerRegistration.findFirst({
      where: { userId, status: PENDING },
      select: { id: true, submittedAt: true },
    });
    return row === null ? undefined : toPendingRegistration(row);
  }

  /**
   * Erasure's step (rdm-spec I-1, I-8), inside its transaction: an open application is withdrawn,
   * and every row loses its national ID, its contact fields and the applicant's own note, with one
   * `OWNER_PII_REDACTED` audit row each. The business name and address and the staff notes are
   * business records and stay. A row redacted earlier keeps its first `pii_redacted_at`.
   */
  async eraseFor(
    tx: Prisma.TransactionClient,
    userId: string,
    now: Date,
    // FIXME Do not use an object literal as default for parameter `origin`.
    origin: AuditOrigin = { ip: null, userAgent: null },
  ): Promise<RegistrationErasure> {
    const rows = await tx.ownerRegistration.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    if (rows.length === 0) return { withdrawn: 0, cleared: 0 };
    const withdrawn = await tx.ownerRegistration.updateMany({
      where: { userId, status: PENDING },
      data: { status: OwnerRegistrationStatus.WITHDRAWN },
    });
    await tx.ownerRegistration.updateMany({
      where: { userId, piiRedactedAt: null },
      data: { piiRedactedAt: now },
    });
    await tx.ownerRegistration.updateMany({
      where: { userId },
      data: {
        nationalIdCiphertext: null,
        nationalIdLast4: null,
        contactName: '',
        contactPhone: '',
        applicantNote: null,
      },
    });
    await this.outbox.addMany(
      tx,
      AUDIT_RECORD,
      rows.map(({ id }) =>
        auditRecord({
          actor: { type: AuditActorType.USER, userId },
          action: AuditAction.OWNER_PII_REDACTED,
          resource: { type: AuditResourceType.OWNER_REGISTRATION, id },
          origin,
          now,
        }),
      ),
    );
    return { withdrawn: withdrawn.count, cleared: rows.length };
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actor: AccountContext,
    action: AuditAction,
    registrationId: string,
    now: Date,
    metadata: AuditFacts['metadata'],
  ): Promise<void> {
    await this.outbox.add(
      tx,
      AUDIT_RECORD,
      auditRecord({
        actor: { type: AuditActorType.USER, userId: actor.userId },
        action,
        resource: { type: AuditResourceType.OWNER_REGISTRATION, id: registrationId },
        metadata,
        origin: actor.origin,
        now,
      }),
    );
  }
}
