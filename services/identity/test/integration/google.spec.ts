// Continue with Google (ADRs 0062–0064) against the database, Redis and the fake issuer: every row
// of the sign-in table, the confirmation, the password step's link, unlinking, and a password-less
// account elsewhere.
import {
  ActionTokenPurpose,
  AuditAction,
  IdentityProvider,
  PROOF_TOKEN_TYPES,
  SystemRole,
} from '@wayfare/contracts';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { hashToken, OutboxService } from '@wayfare/nest-common';
import { buildAccountContext, buildAnonymousContext } from '@wayfare/nest-common/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fakeGoogleKeys } from '../../src/modules/google/domain/google-keys';
import { GoogleService } from '../../src/modules/google/google.service';
import { testPrisma, truncateAll } from '../setup/database';
import {
  CLIENT,
  claimsOf,
  errorOf,
  freshEmail,
  PASSWORD,
  registerAccount,
  registerDevice,
  staffAccount,
} from '../setup/fixtures';
import { identityServices } from '../setup/services';

const prisma = testPrisma();
const services = identityServices(prisma);
const { auth, users, emailChange, passwords, mailbox, dispatcher, config, tokens } = services;
const redis = new Redis(config.get('REDIS_URL', { infer: true }), { maxRetriesPerRequest: 1 });
const google = new GoogleService(
  prisma,
  new OutboxService(),
  tokens,
  services.access,
  services.legal,
  services.sessions,
  services.links,
  services.email,
  dispatcher,
  auth,
  redis,
  fakeGoogleKeys(config.get('GOOGLE_FAKE_SIGNING_KEY', { infer: true })),
  config,
);
const anonymous = buildAnonymousContext();

beforeEach(async () => {
  await truncateAll(prisma);
  mailbox.reset();
});
afterAll(async () => {
  await redis.quit();
  await prisma.$disconnect();
});

interface Pick {
  readonly email: string;
  readonly sub?: string;
  readonly hd?: string;
  readonly emailVerified?: boolean;
  readonly name?: string;
}

/** What Google would hand the device: a token carrying a nonce this service gave it. */
async function tokenFor(
  device: { context: ReturnType<typeof buildAnonymousContext> | object },
  pick: Pick,
) {
  const { nonce } = await google.nonce(device.context as never);
  return google.mintFake({
    email: pick.email,
    ...(pick.sub === undefined ? {} : { sub: pick.sub }),
    ...(pick.hd === undefined ? {} : { hd: pick.hd }),
    ...(pick.name === undefined ? {} : { name: pick.name }),
    emailVerified: pick.emailVerified ?? true,
    nonce,
  }).idToken;
}

/** A tourist's phone continuing with Google as `pick`. */
async function continueWith(pick: Pick, device?: Awaited<ReturnType<typeof registerDevice>>) {
  const phone = device ?? (await registerDevice(services));
  const idToken = await tokenFor(phone, pick);
  const answer = await google.signIn(
    { idToken, preferredLocale: 'en', client: CLIENT.mobile },
    phone.context,
  );
  const sid = claimsOf(answer.session!.accessToken).sid as string;
  const context = buildAccountContext({
    userId: answer.session!.user!.id,
    sessionId: sid,
    deviceId: phone.deviceId,
  });
  return { answer, phone, context, userId: answer.session!.user!.id };
}

const outcome = (value: identityGrpc.GoogleOutcome) => identityGrpc.GoogleOutcome[value];
const failed = async (pick: Pick) =>
  errorOf(
    (async () => {
      const phone = await registerDevice(services);
      return google.signIn(
        { idToken: await tokenFor(phone, pick), preferredLocale: 'en', client: CLIENT.mobile },
        phone.context,
      );
    })(),
  );
const linkOf = (userId: string) =>
  prisma.userIdentity.findUnique({
    where: { userId_provider: { userId, provider: IdentityProvider.GOOGLE } },
  });
const verified = async (email: string) => {
  const { session } = await registerAccount(services, { email });
  await prisma.user.update({ where: { id: session.user!.id }, data: { isEmailVerified: true } });
  return session;
};

describe('continuing with Google', () => {
  it('creates a verified, password-less account with its terms and the link (CREATED)', async () => {
    const email = freshEmail();
    const { answer, userId, phone } = await continueWith({ email, name: '  Mai   Nguyen ' });
    expect(outcome(answer.outcome)).toBe('GOOGLE_OUTCOME_CREATED');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user).toMatchObject({
      isEmailVerified: true,
      passwordHash: null,
      fullName: 'Mai Nguyen',
    });
    expect(await linkOf(userId)).toMatchObject({ emailAtLink: email });
    expect(await prisma.legalAcceptance.count({ where: { userId } })).toBe(1);
    // The phone is claimed, as a password sign-in claims it.
    expect((await prisma.device.findUniqueOrThrow({ where: { id: phone.deviceId } })).userId).toBe(
      userId,
    );
  });

  it('signs the same Google account in again (SIGNED_IN), whatever its address is now', async () => {
    const email = freshEmail();
    const first = await continueWith({ email, sub: 'g-1' });
    const again = await continueWith({ email: 'renamed@gmail.com', sub: 'g-1' });
    expect(outcome(again.answer.outcome)).toBe('GOOGLE_OUTCOME_SIGNED_IN');
    expect(again.userId).toBe(first.userId);
    // The link is by subject: the account's address never follows Google's.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: first.userId } })).email).toBe(
      email,
    );
  });

  it('links a verified account where Google owns the mailbox, keeping its password (LINKED)', async () => {
    const email = freshEmail();
    const session = await verified(email);
    const { answer, userId } = await continueWith({ email, hd: 'example.com' });
    expect(outcome(answer.outcome)).toBe('GOOGLE_OUTCOME_LINKED');
    expect(userId).toBe(session.user!.id);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.passwordHash).not.toBeNull();
    expect(user.credentialsChangedAt).not.toBeNull();
    expect(await linkOf(userId)).not.toBeNull();
  });

  it('removes the password of a never-verified account, ends its sessions and says so by email', async () => {
    const email = freshEmail();
    const { session } = await registerAccount(services, { email });
    const oldFamily = claimsOf(session.accessToken).sid as string;
    const { answer, userId } = await continueWith({ email, hd: 'example.com' });
    expect(outcome(answer.outcome)).toBe('GOOGLE_OUTCOME_LINKED_PASSWORD_REMOVED');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user).toMatchObject({ passwordHash: null, isEmailVerified: true });
    expect(user.credentialsChangedAt).not.toBeNull();
    const old = await prisma.session.findFirstOrThrow({ where: { familyId: oldFamily } });
    expect(old.revokedAt).not.toBeNull();
    // Every live verification and reset link is dead.
    expect(
      await prisma.actionToken.count({
        where: {
          userId,
          purpose: ActionTokenPurpose.EMAIL_VERIFICATION,
          invalidatedAt: null,
          usedAt: null,
        },
      }),
    ).toBe(0);
    await dispatcher.idle();
    expect(mailbox.to(email).map((mail) => mail.subject)).toContain(
      'Your Wayfare password was removed',
    );
    const login = await errorOf(
      auth.login({ email, password: PASSWORD, client: CLIENT.mobile }, anonymous),
    );
    expect(login.code).toBe('INVALID_CREDENTIALS');
  });

  it('asks for the password where Google does not own the mailbox, linking nothing (ADR 0064)', async () => {
    const email = freshEmail();
    const { session } = await registerAccount(services, { email });
    const phone = await registerDevice(services);
    const idToken = await tokenFor(phone, { email, sub: 'g-yahoo' });
    const refused = await errorOf(
      google.signIn({ idToken, preferredLocale: 'en', client: CLIENT.mobile }, phone.context),
    );
    expect(refused.code).toBe('GOOGLE_LINK_NEEDS_PASSWORD');
    expect(await linkOf(session.user!.id)).toBeNull();
    // An unverified account's password stays: only Google's own mailboxes prove the address.
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).passwordHash).not.toBeNull();

    // The password through login, on the same phone, then the ticket links.
    const signedIn = await auth.login(
      { email, password: PASSWORD, client: CLIENT.mobile },
      phone.context,
    );
    const context = buildAccountContext({
      userId: session.user!.id,
      sessionId: claimsOf(signedIn.session!.accessToken).sid as string,
      deviceId: phone.deviceId,
    });
    const ticket = (refused.details as { linkTicket: string }).linkTicket;
    // Another phone cannot spend it.
    expect(
      (await errorOf(google.link({ linkTicket: ticket }, { ...context, deviceId: 'other' }))).code,
    ).toBe('CONFIRMATION_EXPIRED');
    await google.link({ linkTicket: ticket }, context);
    expect(await linkOf(session.user!.id)).toMatchObject({ subject: 'g-yahoo' });
    // Then Google signs that account in.
    const again = await continueWith({ email, sub: 'g-yahoo' });
    expect(outcome(again.answer.outcome)).toBe('GOOGLE_OUTCOME_SIGNED_IN');
  });

  it('refuses closed, locked, reserved, already-linked and staff accounts', async () => {
    const closed = await staffAccount(prisma, [SystemRole.USER], { deletedAt: new Date() });
    const closedEmail = (await prisma.user.findUniqueOrThrow({ where: { id: closed.id } })).email;
    expect((await failed({ email: closedEmail, hd: 'example.com' })).code).toBe(
      'ACCOUNT_DEACTIVATED',
    );

    const lockedEmail = freshEmail();
    const locked = await verified(lockedEmail);
    await prisma.user.update({ where: { id: locked.user!.id }, data: { isLocked: true } });
    expect((await failed({ email: lockedEmail, hd: 'example.com' })).code).toBe('ACCOUNT_LOCKED');

    const reserved = freshEmail();
    const holder = await verified(freshEmail());
    await prisma.actionToken.create({
      data: {
        userId: holder.user!.id,
        purpose: ActionTokenPurpose.EMAIL_CHANGE_REVERT,
        tokenHash: hashToken('revert'),
        targetEmail: reserved,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    expect((await failed({ email: reserved })).code).toBe('EMAIL_TAKEN');

    const linkedEmail = freshEmail();
    await continueWith({ email: linkedEmail, sub: 'g-first' });
    expect((await failed({ email: linkedEmail, sub: 'g-second', hd: 'example.com' })).code).toBe(
      'GOOGLE_ACCOUNT_ALREADY_LINKED',
    );

    const staffEmail = freshEmail();
    const staff = await staffAccount(prisma, [SystemRole.ADMIN], {
      email: staffEmail,
    });
    expect((await failed({ email: staffEmail, hd: 'example.com' })).code).toBe(
      'GOOGLE_SIGN_IN_NOT_ALLOWED',
    );
    // A linked account given a staff role is refused too, and allowed again once it is removed.
    const tourist = await continueWith({ email: freshEmail(), sub: 'g-promoted' });
    const admin = await prisma.role.findUniqueOrThrow({ where: { code: SystemRole.ADMIN } });
    await prisma.userRole.create({ data: { userId: tourist.userId, roleId: admin.id } });
    const promotedEmail = (await prisma.user.findUniqueOrThrow({ where: { id: tourist.userId } }))
      .email;
    expect((await failed({ email: promotedEmail, sub: 'g-promoted' })).code).toBe(
      'GOOGLE_SIGN_IN_NOT_ALLOWED',
    );
    await prisma.userRole.deleteMany({ where: { userId: tourist.userId, roleId: admin.id } });
    const back = await continueWith({ email: promotedEmail, sub: 'g-promoted' });
    expect(outcome(back.answer.outcome)).toBe('GOOGLE_OUTCOME_SIGNED_IN');
    expect(staff.id).toBeDefined();
  });

  it('refuses an unverified address, a nonce from another phone, and a replay', async () => {
    const unverified = await failed({ email: freshEmail(), emailVerified: false });
    expect(unverified).toEqual({
      code: 'INVALID_GOOGLE_TOKEN',
      details: { reason: 'EMAIL_NOT_VERIFIED' },
    });

    const mine = await registerDevice(services);
    const theirs = await registerDevice(services);
    const idToken = await tokenFor(mine, { email: freshEmail() });
    const elsewhere = await errorOf(
      google.signIn({ idToken, preferredLocale: 'en', client: CLIENT.mobile }, theirs.context),
    );
    expect(elsewhere).toEqual({ code: 'INVALID_GOOGLE_TOKEN', details: { reason: 'NONCE' } });

    const once = await registerDevice(services);
    const token = await tokenFor(once, { email: freshEmail() });
    await google.signIn(
      { idToken: token, preferredLocale: 'en', client: CLIENT.mobile },
      once.context,
    );
    const replay = await errorOf(
      google.signIn({ idToken: token, preferredLocale: 'en', client: CLIENT.mobile }, once.context),
    );
    expect(replay).toEqual({ code: 'INVALID_GOOGLE_TOKEN', details: { reason: 'NONCE' } });
  });
});

describe('a password-less account', () => {
  it('confirms with Google where it would give its password: email change and erasure', async () => {
    const { phone, context, userId } = await continueWith({
      email: freshEmail(),
      sub: 'g-confirm',
    });
    const confirm = async () =>
      (
        await google.confirm(
          { idToken: await tokenFor(phone, { email: 'x@gmail.com', sub: 'g-confirm' }) },
          context,
        )
      ).confirmation;
    const newEmail = freshEmail();
    await emailChange.requestEmailChange(
      { newEmail, currentPassword: '', confirmation: await confirm() },
      context,
    );
    // Another Google account cannot confirm for this one.
    const other = await errorOf(
      google.confirm(
        { idToken: await tokenFor(phone, { email: 'y@gmail.com', sub: 'g-other' }) },
        context,
      ),
    );
    expect(other.code).toBe('GOOGLE_ACCOUNT_MISMATCH');
    // A lapsed proof, and one for another session, are no longer good.
    const lapsed = tokens.signProof(
      PROOF_TOKEN_TYPES.googleConfirmation,
      { sub: userId, sid: context.sessionId },
      1,
      new Date(Date.now() - 120_000),
    ).token;
    expect(
      (await errorOf(users.eraseMe({ currentPassword: '', confirmation: lapsed }, context))).code,
    ).toBe('CONFIRMATION_EXPIRED');
    const foreign = await confirm();
    expect(
      (
        await errorOf(
          users.eraseMe(
            { currentPassword: '', confirmation: foreign },
            { ...context, sessionId: 'x' },
          ),
        )
      ).code,
    ).toBe('CONFIRMATION_EXPIRED');
    // Both, or neither, is a malformed request.
    expect(
      (await errorOf(users.eraseMe({ currentPassword: 'x', confirmation: foreign }, context))).code,
    ).toBe('VALIDATION_FAILED');
  });

  it('has no password to change, cannot sign in with one, and says how it signs in', async () => {
    const email = freshEmail();
    const { context } = await continueWith({ email });
    expect(
      (
        await errorOf(
          passwords.changePassword(
            { currentPassword: 'anything', newPassword: 'a new password here' },
            context,
          ),
        )
      ).code,
    ).toBe('PASSWORD_NOT_SET');
    expect(
      (
        await errorOf(
          auth.login({ email, password: 'anything at all', client: CLIENT.mobile }, anonymous),
        )
      ).code,
    ).toBe('INVALID_CREDENTIALS');
    expect((await users.getMe(context)).signIn).toEqual({ password: false, google: true });
  });
});

describe('unlinking', () => {
  it('with the password: the link goes, other phones sign out, this session stays', async () => {
    const email = freshEmail();
    const session = await verified(email);
    const elsewhere = claimsOf(session.accessToken).sid as string;
    const { context, userId } = await continueWith({ email, hd: 'example.com' });
    await google.unlink({ currentPassword: PASSWORD, confirmation: '' }, context);
    expect(await linkOf(userId)).toBeNull();
    const other = await prisma.session.findFirstOrThrow({ where: { familyId: elsewhere } });
    expect(other.revokedAt).not.toBeNull();
    const mine = await prisma.session.findMany({ where: { familyId: context.sessionId } });
    expect(mine.every((row) => row.revokedAt === null)).toBe(true);
    const audit = await prisma.outboxEvent.findMany({ where: { subject: 'audit.record' } });
    expect(audit.map((row) => (row.payload as { action: string }).action)).toEqual(
      expect.arrayContaining([AuditAction.GOOGLE_LINKED, AuditAction.GOOGLE_UNLINKED]),
    );
    expect((await users.getMe(context)).signIn).toEqual({ password: true, google: false });
  });

  it('never from an account with no password', async () => {
    const { context } = await continueWith({ email: freshEmail() });
    expect(
      (await errorOf(google.unlink({ currentPassword: 'x', confirmation: '' }, context))).code,
    ).toBe('PASSWORD_REQUIRED');
  });

  it('stamps an owner’s credentials change on linking and unlinking (the payout cooldown)', async () => {
    const email = freshEmail();
    const owner = await verified(email);
    await prisma.user.update({
      where: { id: owner.user!.id },
      data: { ownerVerifiedAt: new Date(), credentialsChangedAt: null },
    });
    const { context, userId } = await continueWith({ email, hd: 'example.com' });
    const linked = (await prisma.user.findUniqueOrThrow({ where: { id: userId } }))
      .credentialsChangedAt;
    expect(linked).not.toBeNull();
    await google.unlink({ currentPassword: PASSWORD, confirmation: '' }, context);
    const unlinked = (await prisma.user.findUniqueOrThrow({ where: { id: userId } }))
      .credentialsChangedAt;
    expect(unlinked!.getTime()).toBeGreaterThanOrEqual(linked!.getTime());
  });
});

describe('the fake issuer', () => {
  it('mints nothing unless configured', () => {
    // Production's refusal of the fake issuer is the env schema's spec (src/config).
    const real = new GoogleService(
      prisma,
      new OutboxService(),
      tokens,
      services.access,
      services.legal,
      services.sessions,
      services.links,
      services.email,
      dispatcher,
      auth,
      redis,
      fakeGoogleKeys(config.get('GOOGLE_FAKE_SIGNING_KEY', { infer: true })),
      {
        get: (key: string) =>
          key === 'GOOGLE_ISSUER' ? 'google' : key === 'GOOGLE_SERVER_CLIENT_ID' ? 'id' : undefined,
      } as never,
    );
    expect(() =>
      real.mintFake({ email: 'a@gmail.com', emailVerified: true, nonce: 'n' }),
    ).toThrow();
  });
});
