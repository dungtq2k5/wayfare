import { Injectable } from '@nestjs/common';
import {
  LegalDocument,
  LegalParty,
  MAX_FULL_NAME_LENGTH,
  MAX_POLICY_VERSION_LENGTH,
  normalizeText,
  zLanguage,
} from '@wayfare/contracts';
import { legalDocumentProto, legalPartyProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import {
  deviceIdOf,
  parseRpcRequest,
  requireProtoEnum,
  requireAccountContext,
  rpcError,
} from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import { AccessService } from '../access/access.service';
import { DevicesService } from '../devices/devices.service';
import { LegalService } from '../legal/legal.service';
import type { LegalPartyRef } from '../legal/legal.service';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_ACCOUNT_SELECT } from '../sessions/sessions.service';
import type { SessionAccount } from '../sessions/sessions.service';
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

/** The caller's own account (api-endpoints-plan §1.3, rdm-spec I-1, I-12). */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly legal: LegalService,
    private readonly devices: DevicesService,
  ) {}

  /** The console's bootstrap read — from the database, not the token. */
  async getMe(context: RequestContext): Promise<identityGrpc.GetMeResponse> {
    const account = requireAccountContext(context);
    return this.prisma.$transaction(async (tx) => {
      const user = await this.liveUser(tx, account.userId);
      const { roles, permissions } = await this.access.accessOf(tx, user.id);
      return {
        user: toSessionUser(user),
        roles,
        permissions,
        ownerVerified: user.ownerVerifiedAt !== null,
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
