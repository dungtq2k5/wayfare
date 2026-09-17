import { Injectable } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  LegalDocument,
  LegalParty,
  MAX_FULL_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_POLICY_VERSION_LENGTH,
  MAX_REFRESH_TOKEN_LENGTH,
  normalizeText,
  parseEnum,
  SessionClient,
  SessionRevokedReason,
  SystemRole,
  zEmail,
  zLanguage,
  zUuidV7,
} from '@wayfare/contracts';
import { sessionClientProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import {
  deviceIdOf,
  hashToken,
  isAccountContext,
  isUniqueConstraintViolation,
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
import { auditRecord } from '../audit/domain/audit-record';
import { DevicesService } from '../devices/devices.service';
import { LegalService } from '../legal/legal.service';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_ACCOUNT_SELECT, SessionsService } from '../sessions/sessions.service';
import type { OpenedSession, SessionAccount } from '../sessions/sessions.service';
import { isPasswordTheEmail, zNewPassword } from '../tokens/domain/password';
import { TokensService } from '../tokens/tokens.service';
import { isLockActive } from '../users/domain/account-state';
import { decideRefresh } from './domain/refresh-decision';
import { toSession } from './session.mapper';

const registerFields = z.object({
  email: zEmail,
  password: zNewPassword,
  fullName: z
    .string()
    .transform(normalizeText)
    .pipe(z.string().min(1).max(MAX_FULL_NAME_LENGTH))
    .optional(),
  preferredLocale: zLanguage,
  termsVersion: z.string().min(1).max(MAX_POLICY_VERSION_LENGTH),
});

const loginFields = z.object({
  email: zEmail,
  // Only the upper bound: a too-short password is simply wrong, never a validation hint.
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

const refreshTokenField = z.string().min(1).max(MAX_REFRESH_TOKEN_LENGTH);

/** Why a login failed — stored for investigations, never returned (rdm-spec I-11). */
type LoginFailure = 'UNKNOWN_EMAIL' | 'BAD_PASSWORD' | 'DEACTIVATED' | 'LOCKED';

const LOGIN_USER_SELECT = {
  ...SESSION_ACCOUNT_SELECT,
  passwordHash: true,
  deletedAt: true,
  isLocked: true,
  lockedUntil: true,
} as const satisfies Prisma.UserSelect;

const LOGIN_USER_SELECT_WITH_ERASURE = {
  ...LOGIN_USER_SELECT,
  erasedAt: true,
} as const satisfies Prisma.UserSelect;

/** Signing in and out, refresh rotation and revocation (api-endpoints-plan §1.2, rdm-spec I-1, I-3). */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly tokens: TokensService,
    private readonly access: AccessService,
    private readonly legal: LegalService,
    private readonly sessions: SessionsService,
    private readonly devices: DevicesService,
  ) {}

  /**
   * Creates an account with the `USER` role and the terms acceptance, claims the calling device
   * (lenient), and signs the person in. Sends nothing yet — email verification is not built.
   */
  async register(
    request: identityGrpc.RegisterRequest,
    context: RequestContext,
  ): Promise<identityGrpc.RegisterResponse> {
    const fields = parseRpcRequest(registerFields, request);
    const client = requireProtoEnum(sessionClientProto, request.client, '/client');
    if (isPasswordTheEmail(fields.password, fields.email)) {
      throw rpcError('VALIDATION_FAILED', { issues: [{ path: '/password', code: 'custom' }] });
    }
    this.legal.requireCurrent(LegalDocument.TERMS_OF_SERVICE, fields.termsVersion);
    const taken = await this.prisma.user.findUnique({
      where: { email: fields.email },
      select: { id: true },
    });
    if (taken !== null) throw rpcError('EMAIL_TAKEN');
    const passwordHash = await this.tokens.hashPassword(fields.password);
    const now = new Date();

    try {
      const session = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: fields.email,
            passwordHash,
            fullName: fields.fullName ?? null,
            preferredLocale: fields.preferredLocale,
          },
          select: SESSION_ACCOUNT_SELECT,
        });
        await this.access.assignRole(tx, user.id, SystemRole.USER);
        await this.legal.record(
          tx,
          { party: LegalParty.USER, userId: user.id },
          LegalDocument.TERMS_OF_SERVICE,
          fields.termsVersion,
          context.origin.ip,
        );
        await this.outbox.add(
          tx,
          AUDIT_RECORD,
          auditRecord({
            actor: { type: AuditActorType.USER, userId: user.id },
            action: AuditAction.USER_REGISTERED,
            resource: { type: AuditResourceType.USER, id: user.id },
            metadata: { after: { preferredLocale: user.preferredLocale, client } },
            origin: context.origin,
            now,
          }),
        );
        return (await this.signIn(tx, user, client, context, now)).session;
      });
      return { session: toSession(session) };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) throw rpcError('EMAIL_TAKEN');
      throw error;
    }
  }

  /**
   * Signs a person in (api-endpoints-plan §1.2). Unknown email, wrong password and a deactivated
   * account are indistinguishable; a lock is revealed only after the password proved the caller
   * knows it. A failure commits its audit row, then throws.
   */
  async login(
    request: identityGrpc.LoginRequest,
    context: RequestContext,
  ): Promise<identityGrpc.LoginResponse> {
    const fields = parseRpcRequest(loginFields, request);
    const client = requireProtoEnum(sessionClientProto, request.client, '/client');
    // No deleted_at filter: the full unique index means a deactivated row still owns the address.
    const user = await this.prisma.user.findUnique({
      where: { email: fields.email },
      select: LOGIN_USER_SELECT,
    });
    const passwordOk = await this.tokens.verifyPassword(
      user?.passwordHash ?? null,
      fields.password,
    );
    const now = new Date();

    const failure: LoginFailure | null =
      user === null
        ? 'UNKNOWN_EMAIL'
        : !passwordOk
          ? 'BAD_PASSWORD'
          : user.deletedAt !== null
            ? 'DEACTIVATED'
            : isLockActive(user, now)
              ? 'LOCKED'
              : null;

    if (user === null || failure !== null) {
      await this.prisma.$transaction(async (tx) => {
        await this.outbox.add(
          tx,
          AUDIT_RECORD,
          auditRecord({
            actor: { type: AuditActorType.ANONYMOUS },
            action: AuditAction.USER_LOGIN_FAILED,
            resource: { type: AuditResourceType.USER, ...(user === null ? {} : { id: user.id }) },
            metadata: { after: { client, failure } },
            origin: context.origin,
            now,
          }),
        );
      });
      // Thrown after the commit, never inside it — a throw inside would roll the audit row back.
      throw failure === 'LOCKED' ? rpcError('ACCOUNT_LOCKED') : rpcError('INVALID_CREDENTIALS');
    }

    const session = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: now,
          // A lapsed lock is its own expiry: cleared silently; the lock itself was audited.
          ...(user.isLocked ? { isLocked: false, lockedUntil: null, lockReason: null } : {}),
        },
        select: { id: true },
      });
      const opened = await this.signIn(tx, user, client, context, now);
      await this.outbox.add(
        tx,
        AUDIT_RECORD,
        auditRecord({
          actor: { type: AuditActorType.USER, userId: user.id },
          action: AuditAction.USER_LOGIN,
          resource: { type: AuditResourceType.USER, id: user.id },
          metadata: { after: { client, deviceClaimed: opened.deviceClaimed } },
          origin: context.origin,
          now,
        }),
      );
      return opened.session;
    });
    return { session: toSession(session) };
  }

  /**
   * Rotates a refresh token (rdm-spec I-3). A lost cookie race answers `INVALID_STATE` and revokes
   * nothing; a replay revokes the family. The user is re-checked and permissions re-read.
   */
  async refresh(
    request: identityGrpc.RefreshRequest,
    context: RequestContext,
  ): Promise<identityGrpc.RefreshResponse> {
    const refreshToken = parseRpcRequest(refreshTokenField, request.refreshToken);
    const client = requireProtoEnum(sessionClientProto, request.client, '/client');
    const tokenHash = hashToken(refreshToken);

    for (let attempt = 1; attempt <= 3; attempt++) {
      const now = new Date();
      const row = await this.prisma.session.findUnique({
        where: { refreshTokenHash: tokenHash },
        select: {
          id: true,
          userId: true,
          familyId: true,
          client: true,
          deviceId: true,
          expiresAt: true,
          rotatedAt: true,
          revokedAt: true,
        },
      });
      if (row === null) throw rpcError('UNAUTHENTICATED');
      const rowClient = parseEnum(SessionClient, row.client);
      const decision = decideRefresh({ ...row, client: rowClient }, client, now);
      if (decision === 'UNKNOWN' || decision === 'REVOKED' || decision === 'EXPIRED') {
        throw rpcError('UNAUTHENTICATED');
      }
      if (decision === 'RACE') throw rpcError('INVALID_STATE', { status: 'ROTATED' });
      if (decision === 'REPLAY') {
        await this.prisma.$transaction(async (tx) => {
          const revoked = await this.sessions.revokeFamilies(
            tx,
            row.userId,
            [row.familyId],
            SessionRevokedReason.REPLAY_DETECTED,
            now,
          );
          await this.outbox.add(
            tx,
            AUDIT_RECORD,
            auditRecord({
              actor: { type: AuditActorType.ANONYMOUS },
              action: AuditAction.REFRESH_TOKEN_REPLAY_DETECTED,
              resource: { type: AuditResourceType.USER, id: row.userId },
              metadata: { after: { client, revokedFamilies: revoked } },
              origin: context.origin,
              now,
            }),
          );
        });
        throw rpcError('UNAUTHENTICATED'); // after the commit: the revocation stands
      }

      const outcome = await this.prisma.$transaction(async (tx) => {
        const rotated = await tx.session.updateMany({
          where: { id: row.id, rotatedAt: null, revokedAt: null },
          data: { rotatedAt: now },
        });
        if (rotated.count === 0) return { kind: 'retry' } as const; // a concurrent refresh won
        const user = await tx.user.findUniqueOrThrow({
          where: { id: row.userId },
          select: LOGIN_USER_SELECT_WITH_ERASURE,
        });
        const reason =
          user.erasedAt !== null
            ? SessionRevokedReason.ERASED
            : user.deletedAt !== null
              ? SessionRevokedReason.ADMIN
              : isLockActive(user, now)
                ? SessionRevokedReason.LOCKED
                : null;
        if (reason !== null) {
          await this.sessions.revokeFamilies(tx, row.userId, [row.familyId], reason, now);
          return { kind: 'revoked' } as const;
        }
        const session = await this.sessions.open(tx, {
          user,
          client: rowClient,
          deviceId: row.deviceId,
          tokenDeviceId: row.deviceId,
          origin: context.origin,
          now,
          lineage: {
            familyId: row.familyId,
            client: rowClient,
            deviceId: row.deviceId,
            expiresAt: row.expiresAt,
          },
        });
        return { kind: 'rotated', session } as const;
      });
      // Never ACCOUNT_LOCKED here: that would confirm a lock to whoever holds a stolen token.
      if (outcome.kind === 'revoked') throw rpcError('UNAUTHENTICATED');
      if (outcome.kind === 'rotated') return { session: toSession(outcome.session) };
    }
    throw rpcError('INVALID_STATE', { status: 'ROTATED' });
  }

  /**
   * Signs a session family out (api-endpoints-plan §1.2): the caller's own family when the
   * access token is valid, otherwise the family the presented refresh token names — in any state.
   * No family → success without an audit row.
   */
  async logout(
    request: identityGrpc.LogoutRequest,
    context: RequestContext,
  ): Promise<identityGrpc.LogoutResponse> {
    let target: { userId: string; familyId: string; byRefreshToken: boolean } | null = null;
    if (isAccountContext(context)) {
      target = { userId: context.userId, familyId: context.sessionId, byRefreshToken: false };
    } else if (request.refreshToken !== undefined && request.refreshToken !== '') {
      const refreshToken = parseRpcRequest(refreshTokenField, request.refreshToken);
      const row = await this.prisma.session.findUnique({
        where: { refreshTokenHash: hashToken(refreshToken) },
        select: { userId: true, familyId: true },
      });
      if (row !== null) target = { ...row, byRefreshToken: true };
    }
    if (target === null) return {};
    const { userId, familyId, byRefreshToken } = target;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.sessions.revokeFamilies(tx, userId, [familyId], SessionRevokedReason.LOGOUT, now);
      await this.outbox.add(
        tx,
        AUDIT_RECORD,
        auditRecord({
          actor: { type: AuditActorType.USER, userId },
          action: AuditAction.USER_LOGOUT,
          resource: { type: AuditResourceType.USER, id: userId },
          metadata: { after: { byRefreshToken } },
          origin: context.origin,
          now,
        }),
      );
    });
    return {};
  }

  /** Revokes every family and raises the token cutoff, so every access token dies within seconds. */
  async logoutAll(context: RequestContext): Promise<identityGrpc.LogoutAllResponse> {
    const account = requireAccountContext(context);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const revoked = await this.sessions.revokeAllForUser(
        tx,
        account.userId,
        SessionRevokedReason.LOGOUT_ALL,
        { bumpCutoff: true, now },
      );
      await this.outbox.add(
        tx,
        AUDIT_RECORD,
        auditRecord({
          actor: { type: AuditActorType.USER, userId: account.userId },
          action: AuditAction.USER_LOGOUT_ALL,
          resource: { type: AuditResourceType.USER, id: account.userId },
          metadata: { after: { revokedFamilies: revoked } },
          origin: context.origin,
          now,
        }),
      );
    });
    return {};
  }

  /** Claims the calling device for the signed-in account (strict: a revoked device is refused). */
  async claimDevice(context: RequestContext): Promise<identityGrpc.ClaimDeviceResponse> {
    const account = requireAccountContext(context);
    const deviceId = deviceIdOf(context);
    if (deviceId === null) throw rpcError('UNAUTHENTICATED');
    const now = new Date();
    await this.prisma.$transaction((tx) =>
      this.devices.claimDevice(tx, {
        userId: account.userId,
        deviceId,
        mode: 'strict',
        origin: context.origin,
        now,
      }),
    );
    return {};
  }

  /**
   * A user's token cutoff, for the gateway's revocation check (api-endpoints-plan §12.2). An
   * unknown or erased user is `RESOURCE_NOT_FOUND`, which the gateway turns into "reject all".
   */
  async getTokenCutoff(
    request: identityGrpc.GetTokenCutoffRequest,
  ): Promise<identityGrpc.GetTokenCutoffResponse> {
    const userId = parseRpcRequest(zUuidV7, request.userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tokensValidAfter: true, erasedAt: true },
    });
    if (user === null || user.erasedAt !== null)
      throw rpcError('RESOURCE_NOT_FOUND', { resource: 'USER' });
    return user.tokensValidAfter === null
      ? {}
      : { tokensValidAfterMs: String(user.tokensValidAfter.getTime()) };
  }

  /** Claims the caller's device (lenient) and opens a session on it when it is usable. */
  private async signIn(
    tx: Prisma.TransactionClient,
    user: SessionAccount,
    client: SessionClient,
    context: RequestContext,
    now: Date,
  ): Promise<{ session: OpenedSession; deviceClaimed: boolean }> {
    const deviceId = deviceIdOf(context);
    const claim =
      deviceId === null
        ? { usable: false, changed: false }
        : await this.devices.claimDevice(tx, {
            userId: user.id,
            deviceId,
            mode: 'lenient',
            origin: context.origin,
            now,
          });
    const usableDevice = claim.usable ? deviceId : null;
    const session = await this.sessions.open(tx, {
      user,
      client,
      deviceId: usableDevice,
      tokenDeviceId: usableDevice,
      origin: context.origin,
      now,
    });
    return { session, deviceClaimed: claim.changed };
  }
}

/** The account a use case needs; anything else is `UNAUTHENTICATED`. */
