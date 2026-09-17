import { Injectable } from '@nestjs/common';
import {
  IDENTITY_SESSION_REVOKED,
  MAX_FAMILIES_PER_EVENT,
  newId,
  REFRESH_TOKEN_TTL_MS,
  SessionClient,
  SessionRevokedReason,
  TokenRevocationReason,
} from '@wayfare/contracts';
import { generateToken, hashToken, OutboxService } from '@wayfare/nest-common';
import type { RequestOrigin } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';
import { AccessService } from '../access/access.service';
import { TokensService } from '../tokens/tokens.service';

/** The account fields a session and its token are built from. */
export interface SessionAccount {
  readonly id: string;
  readonly email: string;
  readonly fullName: string | null;
  readonly preferredLocale: string;
  readonly isEmailVerified: boolean;
  readonly ownerVerifiedAt: Date | null;
  readonly createdAt: Date;
}

/** The select that loads a `SessionAccount`. */
export const SESSION_ACCOUNT_SELECT = {
  id: true,
  email: true,
  fullName: true,
  preferredLocale: true,
  isEmailVerified: true,
  ownerVerifiedAt: true,
  createdAt: true,
} as const satisfies Prisma.UserSelect;

/** A freshly opened or rotated session; the gateway decides what travels where. */
export interface OpenedSession {
  readonly user: SessionAccount;
  readonly accessToken: string;
  readonly accessExpiresAt: Date;
  /** Plaintext, returned once; only its hash is stored. */
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
}

/** Where a session row is continued from, when rotating. */
export interface SessionLineage {
  readonly familyId: string;
  readonly client: SessionClient;
  readonly deviceId: string | null;
  readonly expiresAt: Date;
}

/**
 * `SessionsService.bumpCutoff` without the service — for scripts, which hold no signing key. The
 * events are written in batches.
 */
export async function bumpTokenCutoff(
  tx: Prisma.TransactionClient,
  outbox: Pick<OutboxService, 'addMany'>,
  userIds: readonly string[],
  now: Date,
): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  await tx.user.updateMany({ where: { id: { in: unique } }, data: { tokensValidAfter: now } });
  await outbox.addMany(
    tx,
    IDENTITY_SESSION_REVOKED,
    unique.map((userId) => ({
      occurredAt: now.toISOString(),
      userId,
      familyIds: null,
      tokensValidAfter: now.toISOString(),
      reason: TokenRevocationReason.PERMISSIONS_CHANGED,
    })),
  );
}

/**
 * Opens, rotates and revokes sessions (rdm-spec I-3). Every revocation publishes
 * `identity.session.revoked` in the same transaction, so the gateway learns of it within seconds.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly access: AccessService,
    private readonly tokens: TokensService,
  ) {}

  /**
   * Inserts a session row and signs its access token. A new login starts a family; a rotation
   * passes its `lineage`, keeping the family, client, device and expiry — never extending it.
   * `tokenDeviceId` is the `did` claim: the device the sign-in claimed, if any.
   */
  async open(
    tx: Prisma.TransactionClient,
    input: {
      readonly user: SessionAccount;
      readonly client: SessionClient;
      readonly deviceId: string | null;
      readonly tokenDeviceId: string | null;
      readonly origin: RequestOrigin;
      readonly now: Date;
      readonly lineage?: SessionLineage;
    },
  ): Promise<OpenedSession> {
    const { user, origin, now, lineage } = input;
    const familyId = lineage?.familyId ?? newId();
    const refreshToken = generateToken();
    const refreshExpiresAt = lineage?.expiresAt ?? new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
    // I-3: only a mobile session lives on a device.
    const sessionDeviceId =
      (lineage?.client ?? input.client) === SessionClient.MOBILE
        ? (lineage?.deviceId ?? input.deviceId)
        : null;
    await tx.session.create({
      data: {
        userId: user.id,
        deviceId: sessionDeviceId,
        familyId,
        refreshTokenHash: hashToken(refreshToken),
        client: lineage?.client ?? input.client,
        ip: origin.ip,
        userAgent: origin.userAgent?.slice(0, 512) ?? null,
        expiresAt: refreshExpiresAt,
      },
      select: { id: true },
    });
    const { permissions } = await this.access.accessOf(tx, user.id);
    const access = this.tokens.signAccountToken(
      {
        userId: user.id,
        sessionId: familyId,
        deviceId: input.tokenDeviceId,
        permissions,
        ownerVerified: user.ownerVerifiedAt !== null,
        emailVerified: user.isEmailVerified,
      },
      now,
    );
    return {
      user,
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      refreshToken,
      refreshExpiresAt,
    };
  }

  /**
   * Revokes the live rows of the given families and publishes the revocation, in chunks of
   * `MAX_FAMILIES_PER_EVENT`. Returns how many families had a live row.
   */
  async revokeFamilies(
    tx: Prisma.TransactionClient,
    userId: string,
    familyIds: readonly string[],
    reason: SessionRevokedReason,
    now: Date,
  ): Promise<number> {
    const unique = [...new Set(familyIds)];
    if (unique.length === 0) return 0;
    await tx.session.updateMany({
      where: { userId, familyId: { in: unique }, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    for (let start = 0; start < unique.length; start += MAX_FAMILIES_PER_EVENT) {
      await this.outbox.add(tx, IDENTITY_SESSION_REVOKED, {
        occurredAt: now.toISOString(),
        userId,
        familyIds: unique.slice(start, start + MAX_FAMILIES_PER_EVENT),
        tokensValidAfter: null,
        reason,
      });
    }
    return unique.length;
  }

  /** The families with a live row for a user, optionally only those on one device. */
  async liveFamilies(
    tx: Prisma.TransactionClient,
    userId: string,
    now: Date,
    deviceId?: string,
  ): Promise<string[]> {
    const rows = await tx.session.findMany({
      where: {
        userId,
        rotatedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
        ...(deviceId === undefined ? {} : { deviceId }),
      },
      select: { familyId: true },
      distinct: ['familyId'],
    });
    return rows.map((row) => row.familyId);
  }

  /**
   * Revokes every live family of a user. With `bumpCutoff`, also raises the token cutoff to `now`
   * — nothing issued before it is accepted any more — and publishes one event with
   * `familyIds: null`; without it, publishes the revoked families in chunks of
   * `MAX_FAMILIES_PER_EVENT`. Returns how many families were live.
   */
  async revokeAllForUser(
    tx: Prisma.TransactionClient,
    userId: string,
    reason: SessionRevokedReason,
    options: { readonly bumpCutoff: boolean; readonly now: Date },
  ): Promise<number> {
    const { bumpCutoff, now } = options;
    const families = await this.liveFamilies(tx, userId, now);
    if (!bumpCutoff) return this.revokeFamilies(tx, userId, families, reason, now);
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    await tx.user.update({
      where: { id: userId },
      data: { tokensValidAfter: now },
      select: { id: true },
    });
    await this.outbox.add(tx, IDENTITY_SESSION_REVOKED, {
      occurredAt: now.toISOString(),
      userId,
      familyIds: null,
      tokensValidAfter: now.toISOString(),
      reason,
    });
    return families.length;
  }

  /**
   * Raises the token cutoff of many users to `now` without revoking a session: their next refresh
   * re-reads the permissions (rdm-spec I-1). One `PERMISSIONS_CHANGED` event per user.
   */
  bumpCutoff(tx: Prisma.TransactionClient, userIds: readonly string[], now: Date): Promise<void> {
    return bumpTokenCutoff(tx, this.outbox, userIds, now);
  }

  /** Revokes every live session on one device, per user, each with its event. */
  async revokeDeviceSessions(
    tx: Prisma.TransactionClient,
    deviceId: string,
    reason: SessionRevokedReason,
    now: Date,
    onlyUserId?: string,
  ): Promise<void> {
    const rows = await tx.session.findMany({
      where: {
        deviceId,
        revokedAt: null,
        rotatedAt: null,
        expiresAt: { gt: now },
        ...(onlyUserId === undefined ? {} : { userId: onlyUserId }),
      },
      select: { userId: true, familyId: true },
    });
    const byUser = new Map<string, string[]>();
    for (const row of rows)
      byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.familyId]);
    for (const [userId, families] of byUser) {
      await this.revokeFamilies(tx, userId, families, reason, now);
    }
  }
}
