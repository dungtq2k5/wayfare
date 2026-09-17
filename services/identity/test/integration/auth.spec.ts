import { compareStrings } from '@wayfare/contracts';
import { hashToken } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { buildAccountContext, buildAnonymousContext } from '@wayfare/nest-common/testing';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';
import {
  claimsOf,
  CLIENT,
  errorCodeOf,
  freshEmail,
  PASSWORD,
  registerAccount,
  registerDevice,
} from '../setup/fixtures';
import { identityServices } from '../setup/services';

const prisma = testPrisma();
const services = identityServices(prisma);
const { auth } = services;
const origin = buildAnonymousContext();

/** A settled rejection's reason, which is always the service's thrown error. */
const asError = (reason: unknown): Error => reason as Error;

beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

function login(
  email: string,
  password = PASSWORD,
  client: number = CLIENT.console,
  context: RequestContext = origin,
) {
  return auth.login({ email, password, client }, context);
}

function refresh(refreshToken: string, client: number = CLIENT.console) {
  return auth.refresh({ refreshToken, client }, origin);
}

async function auditFailures(): Promise<unknown[]> {
  const rows = await prisma.outboxEvent.findMany({
    where: { subject: 'audit.record' },
    orderBy: { id: 'asc' },
  });
  return rows
    .map(
      (row) =>
        row.payload as {
          action: string;
          metadata: { after?: { failure?: string } };
          resource: { id?: string };
        },
    )
    .filter((payload) => payload.action === 'USER_LOGIN_FAILED')
    .map((payload) => ({
      failure: payload.metadata.after?.failure,
      resourceId: payload.resource.id ?? null,
    }));
}

describe('register', () => {
  it('creates the account with the USER role, the terms acceptance and a session', async () => {
    const { email, session } = await registerAccount(services, {
      email: '  New.Person@Example.COM ',
    });
    expect(email).toContain('New.Person');
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'new.person@example.com' },
      include: { roles: { include: { role: true } }, legalAcceptances: true, sessions: true },
    });
    expect(user.isEmailVerified).toBe(false);
    expect(user.roles.map((row) => row.role.code)).toEqual(['USER']);
    expect(user.legalAcceptances).toMatchObject([{ document: 'TERMS_OF_SERVICE', deviceId: null }]);
    expect(user.sessions).toMatchObject([
      { client: 'CONSOLE', deviceId: null, refreshTokenHash: hashToken(session.refreshToken) },
    ]);
    expect(claimsOf(session.accessToken)).toMatchObject({
      typ: 'user',
      sub: user.id,
      perms: [],
      ov: false,
      ev: false,
    });
    expect(session.user).toMatchObject({ email: 'new.person@example.com', isEmailVerified: false });
  });

  it('refuses a taken address, before and during the unique-index race', async () => {
    const email = freshEmail();
    await registerAccount(services, { email });
    expect(await errorCodeOf(registerAccount(services, { email: email.toUpperCase() }))).toBe(
      'EMAIL_TAKEN',
    );
    const racing = freshEmail();
    const results = await Promise.allSettled([
      registerAccount(services, { email: racing }),
      registerAccount(services, { email: racing }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    await expect(
      errorCodeOf(Promise.reject(asError((rejected as PromiseRejectedResult).reason))),
    ).resolves.toBe('EMAIL_TAKEN');
  });

  it('refuses an outdated terms version and a password equal to the email', async () => {
    const email = freshEmail();
    const base = { email, password: PASSWORD, preferredLocale: 'en', client: CLIENT.console };
    expect(await errorCodeOf(auth.register({ ...base, termsVersion: '2020-01-01' }, origin))).toBe(
      'LEGAL_VERSION_OUTDATED',
    );
    expect(
      await errorCodeOf(
        auth.register({ ...base, password: email, termsVersion: '2026-09-01' }, origin),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('claims the calling device and binds a mobile session to it', async () => {
    const device = await registerDevice(services);
    const { session } = await registerAccount(services, {
      client: CLIENT.mobile,
      context: device.context,
    });
    const row = await prisma.device.findUniqueOrThrow({ where: { id: device.deviceId } });
    expect(row.userId).toBe(session.user!.id);
    expect(claimsOf(session.accessToken).did).toBe(device.deviceId);
    expect(await prisma.session.findFirstOrThrow()).toMatchObject({
      deviceId: device.deviceId,
      client: 'MOBILE',
    });
    const subjects = (await prisma.outboxEvent.findMany()).map((event) => event.subject);
    expect(subjects).toContain('identity.device.claimed');
  });
});

describe('login', () => {
  it('opens a session and stamps last_login_at', async () => {
    const { email } = await registerAccount(services);
    const { session } = await login(email.toUpperCase());
    expect(session?.refreshToken).toBeTruthy();
    expect((await prisma.user.findFirstOrThrow()).lastLoginAt).toBeInstanceOf(Date);
  });

  it('verifies against the dummy hash for an unknown email', async () => {
    const spy = vi.spyOn(services.tokens, 'verifyPassword');
    expect(await errorCodeOf(login(freshEmail()))).toBe('INVALID_CREDENTIALS');
    expect(spy).toHaveBeenCalledWith(null, PASSWORD);
    spy.mockRestore();
  });

  it('answers the four failures without revealing which, and records each one — after the throw', async () => {
    const { email: known } = await registerAccount(services);
    const user = await prisma.user.findFirstOrThrow();

    expect(await errorCodeOf(login(freshEmail()))).toBe('INVALID_CREDENTIALS');
    expect(await errorCodeOf(login(known, 'wrong password!'))).toBe('INVALID_CREDENTIALS');
    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
    expect(await errorCodeOf(login(known))).toBe('INVALID_CREDENTIALS');
    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: null, isLocked: true } });
    expect(await errorCodeOf(login(known))).toBe('ACCOUNT_LOCKED');
    // A wrong password on a locked account reveals nothing.
    expect(await errorCodeOf(login(known, 'wrong password!'))).toBe('INVALID_CREDENTIALS');

    expect(await auditFailures()).toEqual([
      { failure: 'UNKNOWN_EMAIL', resourceId: null },
      { failure: 'BAD_PASSWORD', resourceId: user.id },
      { failure: 'DEACTIVATED', resourceId: user.id },
      { failure: 'LOCKED', resourceId: user.id },
      { failure: 'BAD_PASSWORD', resourceId: user.id },
    ]);
  });

  it('treats a lapsed lock as unlocked and clears it', async () => {
    const { email } = await registerAccount(services);
    await prisma.user.updateMany({
      data: { isLocked: true, lockedUntil: new Date(Date.now() - 1000), lockReason: 'review' },
    });
    await login(email);
    expect(await prisma.user.findFirstOrThrow()).toMatchObject({
      isLocked: false,
      lockedUntil: null,
      lockReason: null,
    });
  });

  it('skips a revoked device instead of failing the sign-in', async () => {
    const { email } = await registerAccount(services);
    const device = await registerDevice(services);
    await services.devices.forgetDevice(device.context);
    const { session } = await login(email, PASSWORD, CLIENT.mobile, device.context);
    expect(claimsOf(session!.accessToken).did).toBeUndefined();
    const sessions = await prisma.session.findMany({ where: { client: 'MOBILE' } });
    expect(sessions).toMatchObject([{ deviceId: null }]);
  });

  it("moves a device claimed by another account and revokes that account's sessions on it", async () => {
    const device = await registerDevice(services);
    const first = await registerAccount(services, {
      client: CLIENT.mobile,
      context: device.context,
    });
    const second = await registerAccount(services);
    await login(second.email, PASSWORD, CLIENT.mobile, device.context);

    const row = await prisma.device.findUniqueOrThrow({ where: { id: device.deviceId } });
    expect(row.userId).toBe(second.session.user!.id);
    const firstSessions = await prisma.session.findMany({
      where: { userId: first.session.user!.id },
    });
    expect(firstSessions).toMatchObject([{ revokedReason: 'LOGOUT' }]);
    const revoked = await prisma.outboxEvent.findMany({
      where: { subject: 'identity.session.revoked' },
    });
    expect(revoked.map((event) => (event.payload as { userId: string }).userId)).toEqual([
      first.session.user!.id,
    ]);
    const claims = await prisma.outboxEvent.count({
      where: { subject: 'identity.device.claimed' },
    });
    expect(claims).toBe(2);
  });
});

describe('refresh', () => {
  it('rotates within the family, keeping its expiry', async () => {
    const { session } = await registerAccount(services);
    const { session: rotated } = await refresh(session.refreshToken);
    const rows = await prisma.session.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.rotatedAt).toBeInstanceOf(Date);
    expect(rows[1]!.familyId).toBe(rows[0]!.familyId);
    expect(rows[1]!.expiresAt).toEqual(rows[0]!.expiresAt);
    expect(rotated!.refreshToken).not.toBe(session.refreshToken);
    expect(claimsOf(rotated!.accessToken).sid).toBe(rows[0]!.familyId);
  });

  it('revokes the whole family on a replay, then refuses the successor too', async () => {
    const { session } = await registerAccount(services, { client: CLIENT.mobile });
    const { session: rotated } = await refresh(session.refreshToken, CLIENT.mobile);
    // Mobile keeps strict rotation: even an immediate reuse is a replay.
    expect(await errorCodeOf(refresh(session.refreshToken, CLIENT.mobile))).toBe('UNAUTHENTICATED');
    expect(await errorCodeOf(refresh(rotated!.refreshToken, CLIENT.mobile))).toBe(
      'UNAUTHENTICATED',
    );
    const rows = await prisma.session.findMany();
    expect(rows.every((row) => row.revokedReason === 'REPLAY_DETECTED')).toBe(true);
    const audit = await prisma.outboxEvent.findMany({ where: { subject: 'audit.record' } });
    expect(audit.map((event) => (event.payload as { action: string }).action)).toContain(
      'REFRESH_TOKEN_REPLAY_DETECTED',
    );
    expect(await prisma.outboxEvent.count({ where: { subject: 'identity.session.revoked' } })).toBe(
      1,
    );
  });

  it('answers a lost console race with INVALID_STATE and revokes nothing', async () => {
    const { session } = await registerAccount(services);
    const results = await Promise.allSettled([
      refresh(session.refreshToken),
      refresh(session.refreshToken),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(await errorCodeOf(Promise.reject(asError(loser.reason)))).toBe('INVALID_STATE');
    expect(await prisma.session.count({ where: { revokedAt: { not: null } } })).toBe(0);
    expect(await prisma.session.count()).toBe(2);
  });

  it('refuses an unknown, expired or revoked token', async () => {
    const { session } = await registerAccount(services);
    expect(await errorCodeOf(refresh('not-a-token'))).toBe('UNAUTHENTICATED');
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });
    expect(await errorCodeOf(refresh(session.refreshToken))).toBe('UNAUTHENTICATED');
  });

  it('revokes the family of a locked user, publishes it, and never says "locked"', async () => {
    const { session } = await registerAccount(services);
    await prisma.user.updateMany({ data: { isLocked: true } });
    expect(await errorCodeOf(refresh(session.refreshToken))).toBe('UNAUTHENTICATED');
    expect(await prisma.session.findFirstOrThrow()).toMatchObject({ revokedReason: 'LOCKED' });
    expect(await prisma.outboxEvent.count({ where: { subject: 'identity.session.revoked' } })).toBe(
      1,
    );
  });

  it('re-reads permissions at rotation', async () => {
    const { session } = await registerAccount(services);
    const user = await prisma.user.findFirstOrThrow();
    const admin = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: admin.id } });
    const { session: rotated } = await refresh(session.refreshToken);
    const perms = claimsOf(rotated!.accessToken).perms as string[];
    expect(perms).toContain('audit.read');
    expect(perms).toEqual(perms.toSorted(compareStrings));
  });
});

describe('logout', () => {
  it("revokes the caller's family by its session id", async () => {
    const { session } = await registerAccount(services);
    const claims = claimsOf(session.accessToken);
    const context = buildAccountContext({
      userId: String(claims.sub),
      sessionId: String(claims.sid),
    });
    await auth.logout({}, context);
    expect(await prisma.session.findFirstOrThrow()).toMatchObject({ revokedReason: 'LOGOUT' });
    expect(await errorCodeOf(refresh(session.refreshToken))).toBe('UNAUTHENTICATED');
  });

  it('finds the family by the refresh token once the access token has expired', async () => {
    const { session } = await registerAccount(services);
    await refresh(session.refreshToken); // the presented token is now spent; it still names the family
    await auth.logout({ refreshToken: session.refreshToken }, origin);
    expect(await prisma.session.count({ where: { revokedReason: 'LOGOUT' } })).toBe(2);
    const audit = await prisma.outboxEvent.findMany({ where: { subject: 'audit.record' } });
    const logout = audit
      .map((event) => event.payload as { action: string; metadata: unknown })
      .find((p) => p.action === 'USER_LOGOUT');
    expect(logout?.metadata).toEqual({ after: { byRefreshToken: true } });
  });

  it('succeeds silently with nothing to revoke', async () => {
    await expect(auth.logout({ refreshToken: 'unknown' }, origin)).resolves.toEqual({});
    await expect(auth.logout({}, origin)).resolves.toEqual({});
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('logout-all revokes every family and raises the cutoff', async () => {
    const { email, session } = await registerAccount(services);
    await login(email);
    const userId = session.user!.id;
    await auth.logoutAll(buildAccountContext({ userId }));
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.tokensValidAfter).toBeInstanceOf(Date);
    expect(await prisma.session.count({ where: { revokedReason: 'LOGOUT_ALL' } })).toBe(2);
    const [event] = await prisma.outboxEvent.findMany({
      where: { subject: 'identity.session.revoked' },
    });
    expect(event?.payload).toMatchObject({
      familyIds: null,
      tokensValidAfter: user.tokensValidAfter!.toISOString(),
    });
    const cutoff = await auth.getTokenCutoff({ userId });
    expect(Number(cutoff.tokensValidAfterMs)).toBe(user.tokensValidAfter!.getTime());
  });
});

describe('token cutoff and device claim', () => {
  it('answers no cutoff for a fresh user and RESOURCE_NOT_FOUND for an unknown or erased one', async () => {
    const { session } = await registerAccount(services);
    expect(await auth.getTokenCutoff({ userId: session.user!.id })).toEqual({});
    expect(
      await errorCodeOf(auth.getTokenCutoff({ userId: '01990000-0000-7000-8000-000000000001' })),
    ).toBe('RESOURCE_NOT_FOUND');
    await prisma.user.updateMany({ data: { deletedAt: new Date(), erasedAt: new Date() } });
    expect(await errorCodeOf(auth.getTokenCutoff({ userId: session.user!.id }))).toBe(
      'RESOURCE_NOT_FOUND',
    );
  });

  it('claims strictly: a revoked device is refused, a live one claimed once', async () => {
    const { session } = await registerAccount(services);
    const userId = session.user!.id;
    const device = await registerDevice(services);
    await auth.claimDevice(buildAccountContext({ userId, deviceId: device.deviceId }));
    await auth.claimDevice(buildAccountContext({ userId, deviceId: device.deviceId }));
    expect(await prisma.outboxEvent.count({ where: { subject: 'identity.device.claimed' } })).toBe(
      1,
    );
    await services.devices.forgetDevice(device.context);
    expect(
      await errorCodeOf(
        auth.claimDevice(buildAccountContext({ userId, deviceId: device.deviceId })),
      ),
    ).toBe('DEVICE_REVOKED');
    expect(await errorCodeOf(auth.claimDevice(buildAccountContext({ userId })))).toBe(
      'UNAUTHENTICATED',
    );
  });
});
