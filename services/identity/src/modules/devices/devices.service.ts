import { Injectable } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  DEVICE_LAST_SEEN_THROTTLE_MS,
  IDENTITY_DEVICE_CLAIMED,
  IDENTITY_DEVICE_FORGOTTEN,
  LegalDocument,
  LegalParty,
  MAX_LANGUAGE_CODE_LENGTH,
  MAX_POLICY_VERSION_LENGTH,
  MAX_PUSH_TOKEN_LENGTH,
  MAX_VERSION_LENGTH,
  newId,
  SessionRevokedReason,
  zUuidV7,
} from '@wayfare/contracts';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import {
  deviceIdOf,
  generateToken,
  hashToken,
  isUniqueConstraintViolation,
  OutboxService,
  parseRpcRequest,
  rpcError,
} from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import { auditRecord } from '../audit/domain/audit-record';
import { LegalService } from '../legal/legal.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import { TokensService } from '../tokens/tokens.service';
import { fromProtoPlatform, toDeviceView } from './device.mapper';
import type { DeviceRow } from './device.mapper';

/** gRPC-edge validation; the gateway validates the same bounds first. */
const registerDeviceFields = z.object({
  appVersion: z.string().min(1).max(MAX_VERSION_LENGTH),
  osVersion: z.string().min(1).max(MAX_VERSION_LENGTH).optional(),
  contentLocale: z.string().min(2).max(MAX_LANGUAGE_CODE_LENGTH),
  privacyPolicyVersion: z.string().min(1).max(MAX_POLICY_VERSION_LENGTH),
});

const exchangeFields = z.object({
  deviceId: zUuidV7,
  deviceSecret: z.string().min(1).max(256),
});

const updateFields = z.object({
  appVersion: z.string().min(1).max(MAX_VERSION_LENGTH).optional(),
  osVersion: z.string().min(1).max(MAX_VERSION_LENGTH).optional(),
  contentLocale: z.string().min(2).max(MAX_LANGUAGE_CODE_LENGTH).optional(),
  pushToken: z.string().min(1).max(MAX_PUSH_TOKEN_LENGTH).optional(),
});

const DEVICE_VIEW_SELECT = {
  id: true,
  appVersion: true,
  osVersion: true,
  contentLocale: true,
} as const satisfies Prisma.DeviceSelect;

/** How a claim treats a revoked device (rdm-spec I-2). */
export type ClaimMode = 'strict' | 'lenient';

/** What a claim did. */
export interface ClaimOutcome {
  /** The device belongs to the user now — a session may live on it. */
  readonly usable: boolean;
  /** This call moved or set the claim. */
  readonly changed: boolean;
}

/** Seconds until an instant, for `expiresIn`. */
function secondsUntil(instant: Date, now: Date): number {
  return Math.max(0, Math.ceil((instant.getTime() - now.getTime()) / 1000));
}

/** Installs — the primary identity (ADR 0003, rdm-spec I-2, api-endpoints-plan §1.1). */
@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly tokens: TokensService,
    private readonly legal: LegalService,
    private readonly sessions: SessionsService,
  ) {}

  /**
   * Creates a device and returns its secret exactly once, with a first device token. Only the
   * secret's SHA-256 is stored. The privacy policy acceptance and the `DEVICE_REGISTERED` audit
   * event are written in the same transaction.
   */
  async registerDevice(
    request: identityGrpc.RegisterDeviceRequest,
    context: RequestContext,
  ): Promise<identityGrpc.RegisterDeviceResponse> {
    const fields = parseRpcRequest(registerDeviceFields, request);
    const platform = fromProtoPlatform(request.platform); // convert once, reuse below
    this.legal.requireCurrent(LegalDocument.PRIVACY_POLICY, fields.privacyPolicyVersion);
    const deviceSecret = generateToken(); // returned once, never stored
    const deviceId = newId();
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.device.create({
        data: {
          id: deviceId,
          secretHash: hashToken(deviceSecret),
          platform,
          appVersion: fields.appVersion,
          osVersion: fields.osVersion ?? null,
          contentLocale: fields.contentLocale,
        },
        select: { id: true },
      });
      await this.legal.record(
        tx,
        { party: LegalParty.DEVICE, deviceId },
        LegalDocument.PRIVACY_POLICY,
        fields.privacyPolicyVersion,
        context.origin.ip,
      );
      await this.outbox.add(
        tx,
        AUDIT_RECORD,
        auditRecord({
          actor: { type: AuditActorType.DEVICE, deviceId },
          action: AuditAction.DEVICE_REGISTERED,
          resource: { type: AuditResourceType.DEVICE, id: deviceId },
          metadata: { after: { platform, appVersion: fields.appVersion } },
          origin: context.origin,
          now,
        }),
      ); // eventId is supplied by outbox.add
    });

    const access = this.tokens.signDeviceToken(deviceId, now);
    return {
      deviceId,
      deviceSecret,
      accessToken: access.token,
      expiresIn: secondsUntil(access.expiresAt, now),
    };
  }

  /**
   * Exchanges a device secret for a device token. The last-seen stamp is written at most once per
   * `DEVICE_LAST_SEEN_THROTTLE_MS`, by a conditional update, so concurrent exchanges write once.
   */
  async exchangeDeviceToken(
    request: identityGrpc.ExchangeDeviceTokenRequest,
  ): Promise<identityGrpc.ExchangeDeviceTokenResponse> {
    const fields = parseRpcRequest(exchangeFields, request);
    const device = await this.prisma.device.findUnique({
      where: { secretHash: hashToken(fields.deviceSecret) },
      select: { id: true, revokedAt: true },
    });
    if (device === null || device.id !== fields.deviceId) throw rpcError('UNAUTHENTICATED');
    if (device.revokedAt !== null) throw rpcError('DEVICE_REVOKED');
    const now = new Date();
    await this.prisma.device.updateMany({
      where: {
        id: device.id,
        lastSeenAt: { lt: new Date(now.getTime() - DEVICE_LAST_SEEN_THROTTLE_MS) },
      },
      data: { lastSeenAt: now },
    });
    const access = this.tokens.signDeviceToken(device.id, now);
    return { accessToken: access.token, expiresIn: secondsUntil(access.expiresAt, now) };
  }

  /**
   * Updates the calling device. A push token held by another row moves here in the same
   * transaction; a concurrent mover trips the unique index, which is retried once.
   */
  async updateDevice(
    request: identityGrpc.UpdateDeviceRequest,
    context: RequestContext,
  ): Promise<identityGrpc.UpdateDeviceResponse> {
    const fields = parseRpcRequest(updateFields, request);
    const deviceId = this.callerDevice(context);
    for (let attempt = 1; ; attempt++) {
      try {
        const row = await this.prisma.$transaction(async (tx) => {
          await this.requireLiveDevice(tx, deviceId);
          if (fields.pushToken !== undefined) {
            await tx.device.updateMany({
              where: { pushToken: fields.pushToken, id: { not: deviceId } },
              data: { pushToken: null },
            });
          }
          return tx.device.update({
            where: { id: deviceId },
            data: {
              ...(fields.appVersion === undefined ? {} : { appVersion: fields.appVersion }),
              ...(fields.osVersion === undefined ? {} : { osVersion: fields.osVersion }),
              ...(fields.contentLocale === undefined
                ? {}
                : { contentLocale: fields.contentLocale }),
              ...(fields.pushToken === undefined ? {} : { pushToken: fields.pushToken }),
            },
            select: DEVICE_VIEW_SELECT,
          });
        });
        return { device: toDeviceView(row) };
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) throw error;
        if (attempt >= 2) throw rpcError('INVALID_STATE', { status: 'PUSH_TOKEN_CONTESTED' });
      }
    }
  }

  /**
   * Forgets the calling install: stamps `revoked_at`, revokes the sessions living on it, and tells
   * catalog to drop its favourites. The account is untouched. A second call changes nothing.
   */
  async forgetDevice(context: RequestContext): Promise<identityGrpc.ForgetDeviceResponse> {
    const deviceId = this.callerDevice(context);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const forgotten = await tx.device.updateMany({
        where: { id: deviceId, revokedAt: null },
        data: { revokedAt: now },
      });
      if (forgotten.count === 0) return; // unknown or already forgotten
      await this.sessions.revokeDeviceSessions(tx, deviceId, SessionRevokedReason.LOGOUT, now);
      await this.outbox.add(tx, IDENTITY_DEVICE_FORGOTTEN, {
        occurredAt: now.toISOString(),
        deviceId,
      });
    });
    return {};
  }

  /**
   * Loads the caller's device and refuses a forgotten one (`DEVICE_REVOKED`). A device token
   * outlives `ForgetDevice` by up to 15 minutes; every use case acting on the device calls this.
   */
  async requireLiveDevice(tx: Prisma.TransactionClient, deviceId: string): Promise<DeviceRow> {
    const device = await tx.device.findUnique({
      where: { id: deviceId },
      select: { ...DEVICE_VIEW_SELECT, revokedAt: true },
    });
    if (device === null) throw rpcError('UNAUTHENTICATED');
    if (device.revokedAt !== null) throw rpcError('DEVICE_REVOKED');
    return device;
  }

  /**
   * Claims a device for a user (rdm-spec I-2). A device claimed by someone else moves, and that
   * user's live sessions on it are revoked. A revoked device fails a `strict` claim and is skipped
   * by a `lenient` one, so a sign-in never fails because of it.
   */
  async claimDevice(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      deviceId: string;
      mode: ClaimMode;
      origin: RequestContext['origin'];
      now: Date;
    },
  ): Promise<ClaimOutcome> {
    const { userId, deviceId, mode, now } = input;
    const device = await tx.device.findUnique({
      where: { id: deviceId },
      select: { userId: true, revokedAt: true },
    });
    if (device === null || device.revokedAt !== null) {
      if (mode === 'strict') throw rpcError('DEVICE_REVOKED');
      return { usable: false, changed: false };
    }
    if (device.userId === userId) return { usable: true, changed: false };

    const previousUserId = device.userId;
    await tx.device.update({
      where: { id: deviceId },
      data: { userId, claimedAt: now },
      select: { id: true },
    });
    if (previousUserId !== null) {
      await this.sessions.revokeDeviceSessions(
        tx,
        deviceId,
        SessionRevokedReason.LOGOUT,
        now,
        previousUserId,
      );
    }
    await this.outbox.add(tx, IDENTITY_DEVICE_CLAIMED, {
      occurredAt: now.toISOString(),
      deviceId,
      userId,
    });
    await this.outbox.add(
      tx,
      AUDIT_RECORD,
      auditRecord({
        actor: { type: AuditActorType.USER, userId },
        action: AuditAction.DEVICE_CLAIMED,
        resource: { type: AuditResourceType.DEVICE, id: deviceId },
        // Whether it was claimed before — never by whom.
        metadata: { before: { previouslyClaimed: previousUserId !== null } },
        origin: input.origin,
        now,
      }),
    );
    return { usable: true, changed: true };
  }

  /** The device the caller acts as: a device token, or an account token carrying one. */
  private callerDevice(context: RequestContext): string {
    const deviceId = deviceIdOf(context);
    if (deviceId === null) throw rpcError('UNAUTHENTICATED');
    return deviceId;
  }
}
