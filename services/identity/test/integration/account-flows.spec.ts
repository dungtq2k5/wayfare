import { AuditAction, SystemRole } from '@wayfare/contracts';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { buildAccountContext, buildAnonymousContext } from '@wayfare/nest-common/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';
import { RecordingEmailProvider } from '../setup/email';
import {
  CLIENT,
  claimsOf,
  errorOf,
  freshEmail,
  PASSWORD,
  registerAccount,
  staffAccount,
} from '../setup/fixtures';
import { identityServices } from '../setup/services';

const prisma = testPrisma();
const services = identityServices(prisma);
const { auth, passwords, emailChange, adminUsers, mailbox, dispatcher } = services;
const anonymous = buildAnonymousContext();
const NEW_PASSWORD = 'a brand new password';

beforeEach(async () => {
  await truncateAll(prisma);
  mailbox.reset();
});
afterAll(() => prisma.$disconnect());

/** Every mail due is sent; then the newest mail to the address, and its token. */
async function lastMail(address: string, subject?: RegExp) {
  await dispatcher.idle();
  const mails = mailbox
    .to(address)
    .filter((mail) => subject === undefined || subject.test(mail.subject));
  const mail = mails.at(-1);
  if (mail === undefined) throw new Error(`No mail to ${address}`);
  return { mail, token: RecordingEmailProvider.tokenOf(mail) };
}

/** A registered console account, with a context acting as its session. */
async function account() {
  const { email, session } = await registerAccount(services);
  const familyId = claimsOf(session.accessToken).sid as string;
  const userId = session.user!.id;
  return { email, userId, familyId, context: buildAccountContext({ userId, sessionId: familyId }) };
}

async function auditActions(): Promise<string[]> {
  const rows = await prisma.outboxEvent.findMany({
    where: { subject: 'audit.record' },
    orderBy: { id: 'asc' },
  });
  return rows.map((row) => (row.payload as { action: string }).action);
}

const login = (email: string, password: string) =>
  auth.login({ email, password, client: CLIENT.console }, anonymous);

describe('verification', () => {
  it('register sends a link; verifying marks the address and clears a bounce', async () => {
    const { email, userId } = await account();
    const { mail, token } = await lastMail(email);
    expect(mail.subject).toBe('Confirm your email address');
    expect(mail.text).toContain('http://web.localhost/verify-email#token=');
    await prisma.user.update({ where: { id: userId }, data: { emailBouncedAt: new Date() } });
    await emailChange.verifyEmail({ token }, anonymous);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user).toMatchObject({ isEmailVerified: true, emailBouncedAt: null });
    expect(user.tokensValidAfter).toBeNull(); // no cutoff bump
    expect(await auditActions()).toContain(AuditAction.EMAIL_VERIFIED);
    expect((await errorOf(emailChange.verifyEmail({ token }, anonymous))).code).toBe(
      'TOKEN_EXPIRED',
    );
  });

  it('a re-send supersedes the first link; a verified account gets nothing', async () => {
    const { email, context } = await account();
    const first = await lastMail(email);
    await emailChange.requestEmailVerification(context);
    const second = await lastMail(email);
    expect(second.token).not.toBe(first.token);
    expect((await errorOf(emailChange.verifyEmail({ token: first.token }, anonymous))).code).toBe(
      'TOKEN_EXPIRED',
    );
    await emailChange.verifyEmail({ token: second.token }, anonymous);
    const before = mailbox.sent.length;
    await emailChange.requestEmailVerification(context);
    await dispatcher.idle();
    expect(mailbox.sent).toHaveLength(before);
  });
});

describe('password reset', () => {
  it('forgot answers the same for a known and an unknown address, and mails only the known one', async () => {
    const { email } = await account();
    mailbox.reset();
    expect(await passwords.requestPasswordReset({ email: email.toUpperCase() }, anonymous)).toEqual(
      {},
    );
    expect(
      await passwords.requestPasswordReset({ email: 'nobody@example.com' }, anonymous),
    ).toEqual({});
    await dispatcher.idle();
    expect(mailbox.sent.map((mail) => mail.to)).toEqual([email]);
    const audits = await prisma.outboxEvent.findMany({ where: { subject: 'audit.record' } });
    const requested = audits
      .map((row) => row.payload as { action: AuditAction; metadata: unknown; resource: object })
      .filter((payload) => payload.action === AuditAction.PASSWORD_RESET_REQUESTED);
    expect(requested.map((payload) => payload.metadata)).toEqual([
      { after: { found: true } },
      { after: { found: false } },
    ]);
  });

  it('validates, resets once, revokes every session and stamps the credentials', async () => {
    const { email, userId } = await account();
    await passwords.requestPasswordReset({ email }, anonymous);
    const { token } = await lastMail(email, /Reset/);
    expect(await passwords.validateResetToken({ token })).toEqual({
      purpose: identityGrpc.ActionTokenPurpose.ACTION_TOKEN_PURPOSE_PASSWORD_RESET,
      emailMasked: `p***${email.split('@')[0]!.at(-1)}@example.com`,
    });
    expect(
      (await errorOf(passwords.completePasswordReset({ token, newPassword: email }, anonymous)))
        .code,
    ).toBe('VALIDATION_FAILED');
    await passwords.completePasswordReset({ token, newPassword: NEW_PASSWORD }, anonymous);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.credentialsChangedAt).not.toBeNull();
    expect(user.tokensValidAfter).not.toBeNull();
    expect(user.isEmailVerified).toBe(true);
    expect(await prisma.session.count({ where: { userId, revokedAt: null } })).toBe(0);
    expect((await errorOf(passwords.validateResetToken({ token }))).code).toBe('TOKEN_EXPIRED');
    expect(
      (
        await errorOf(
          passwords.completePasswordReset({ token, newPassword: NEW_PASSWORD }, anonymous),
        )
      ).code,
    ).toBe('TOKEN_EXPIRED');
    await login(email, NEW_PASSWORD);
    const completed = (await prisma.outboxEvent.findMany({ where: { subject: 'audit.record' } }))
      .map((row) => row.payload as { action: AuditAction; metadata: unknown })
      .find((payload) => payload.action === AuditAction.PASSWORD_RESET_COMPLETED);
    expect(completed?.metadata).toEqual({
      after: { purpose: 'PASSWORD_RESET', hadPassword: true, revokedFamilies: 1 },
    });
  });

  it("a deactivated account's reset link is dead, and forgot sends it nothing", async () => {
    const { email, userId } = await account();
    await passwords.requestPasswordReset({ email }, anonymous);
    const { token } = await lastMail(email, /Reset/);
    await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
    expect((await errorOf(passwords.validateResetToken({ token }))).code).toBe('TOKEN_EXPIRED');
    mailbox.reset();
    await passwords.requestPasswordReset({ email }, anonymous);
    await dispatcher.idle();
    expect(mailbox.sent).toHaveLength(0);
  });
});

describe('staff setup', () => {
  it('creates staff with a setup link that sets the first password without stamping credentials', async () => {
    const admin = await staffAccount(prisma, [SystemRole.SUPER_ADMIN]);
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    const email = freshEmail();
    const { user } = await adminUsers.createStaffUser(
      { email, fullName: 'New Staff', roleIds: [adminRole.id] },
      admin.context,
    );
    const { mail, token } = await lastMail(email);
    expect(mail.subject).toBe('Your Wayfare console account is ready');
    expect(mail.text).toContain('(Super admin)');
    expect(mail.text).toContain('http://console.localhost/setup-account#token=');
    expect(await passwords.validateResetToken({ token })).toMatchObject({
      purpose: identityGrpc.ActionTokenPurpose.ACTION_TOKEN_PURPOSE_ACCOUNT_SETUP,
    });
    await passwords.completePasswordReset({ token, newPassword: NEW_PASSWORD }, anonymous);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user!.id } });
    expect(row).toMatchObject({ isEmailVerified: true, credentialsChangedAt: null });
    await login(email, NEW_PASSWORD);
  });

  it('a setup link on an account that already has a password acts as a reset', async () => {
    const admin = await staffAccount(prisma, [SystemRole.SUPER_ADMIN]);
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    const email = freshEmail();
    const { user } = await adminUsers.createStaffUser(
      { email, fullName: 'New Staff', roleIds: [adminRole.id] },
      admin.context,
    );
    const { token } = await lastMail(email);
    await prisma.user.update({ where: { id: user!.id }, data: { passwordHash: 'set-elsewhere' } });
    await passwords.completePasswordReset({ token, newPassword: NEW_PASSWORD }, anonymous);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user!.id } });
    expect(row.credentialsChangedAt).not.toBeNull();
  });
});

describe('password change', () => {
  it('needs the current password, keeps this session, ends the others and kills reset links', async () => {
    const { email, userId, familyId, context } = await account();
    await login(email, PASSWORD); // a second family
    await passwords.requestPasswordReset({ email }, anonymous);
    const reset = await lastMail(email, /Reset/);
    expect(
      (
        await errorOf(
          passwords.changePassword(
            { currentPassword: 'wrong password', newPassword: NEW_PASSWORD },
            context,
          ),
        )
      ).code,
    ).toBe('CURRENT_PASSWORD_INCORRECT');
    await passwords.changePassword(
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      context,
    );
    const live = await prisma.session.findMany({ where: { userId, revokedAt: null } });
    expect(live.map((session) => session.familyId)).toEqual([familyId]);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.credentialsChangedAt).toBeNull();
    expect(user.tokensValidAfter).toBeNull();
    expect((await errorOf(passwords.validateResetToken({ token: reset.token }))).code).toBe(
      'TOKEN_EXPIRED',
    );
    expect(await auditActions()).toContain(AuditAction.PASSWORD_CHANGED);
  });
});

describe('address change and revert', () => {
  it('confirms, kills the old inbox links, notices the old address, and reverts', async () => {
    const { email: oldAddress, userId, context } = await account();
    await passwords.requestPasswordReset({ email: oldAddress }, anonymous);
    const staleReset = await lastMail(oldAddress, /Reset/);
    const newAddress = freshEmail();

    await emailChange.requestEmailChange(
      { newEmail: newAddress, currentPassword: PASSWORD },
      context,
    );
    const change = await lastMail(newAddress);
    expect(change.mail.subject).toBe('Confirm your new email address');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email).toBe(oldAddress);
    const changeRow = await prisma.emailDelivery.findFirstOrThrow({
      where: { template: 'EMAIL_CHANGE' },
    });
    expect(changeRow.recipientUserId).toBe(userId);

    await emailChange.confirmEmailChange({ token: change.token }, anonymous);
    const moved = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(moved).toMatchObject({ email: newAddress, isEmailVerified: true });
    expect(moved.credentialsChangedAt).not.toBeNull();
    expect((await errorOf(passwords.validateResetToken({ token: staleReset.token }))).code).toBe(
      'TOKEN_EXPIRED',
    );
    const notice = await lastMail(oldAddress, /was changed/);
    expect(notice.mail.text).toContain(`${newAddress.charAt(0)}***`);
    expect(notice.mail.text).toContain('203.0.113.9');
    expect(notice.mail.text).toContain('/revert-email-change#token=');

    // The old address is reserved: nobody may take it during the window.
    expect(
      (await errorOf(registerAccount(services, { email: oldAddress }).then(() => null))).code,
    ).toBe('EMAIL_TAKEN');
    // And this account may not change again until the revert window closes.
    expect(
      (
        await errorOf(
          emailChange.requestEmailChange(
            { newEmail: freshEmail(), currentPassword: PASSWORD },
            context,
          ),
        )
      ).code,
    ).toBe('EMAIL_CHANGE_REVERT_PENDING');

    await emailChange.revertEmailChange({ token: notice.token }, anonymous);
    const restored = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(restored.email).toBe(oldAddress);
    expect(restored.tokensValidAfter).not.toBeNull();
    expect(await prisma.session.count({ where: { userId, revokedAt: null } })).toBe(0);
    const reset = await lastMail(oldAddress, /Reset/);
    await passwords.completePasswordReset(
      { token: reset.token, newPassword: NEW_PASSWORD },
      anonymous,
    );
    await login(oldAddress, NEW_PASSWORD);
    expect(await auditActions()).toEqual(
      expect.arrayContaining([AuditAction.EMAIL_CHANGED, AuditAction.EMAIL_CHANGE_REVERTED]),
    );
    const revoked = await prisma.outboxEvent.findMany({
      where: { subject: 'identity.session.revoked' },
    });
    expect(revoked.map((row) => (row.payload as { reason: string }).reason)).toContain(
      'LOGOUT_ALL',
    );
  });

  it('refuses a wrong password, the same address, and a taken or reserved one', async () => {
    const { email, context } = await account();
    const other = await account();
    const change = (newEmail: string, currentPassword = PASSWORD) =>
      errorOf(emailChange.requestEmailChange({ newEmail, currentPassword }, context));
    expect((await change(freshEmail(), 'wrong password')).code).toBe('CURRENT_PASSWORD_INCORRECT');
    expect(await change(email.toUpperCase())).toEqual({
      code: 'INVALID_STATE',
      details: { status: 'SAME_ADDRESS' },
    });
    expect((await change(other.email)).code).toBe('EMAIL_TAKEN');
  });

  it('a confirm whose address was taken meanwhile rolls back, and the link stays usable', async () => {
    const { userId, context } = await account();
    const newAddress = freshEmail();
    await emailChange.requestEmailChange(
      { newEmail: newAddress, currentPassword: PASSWORD },
      context,
    );
    const { token } = await lastMail(newAddress);
    const squatter = await staffAccount(prisma, [], { email: newAddress });
    expect((await errorOf(emailChange.confirmEmailChange({ token }, anonymous))).code).toBe(
      'EMAIL_TAKEN',
    );
    await prisma.user.delete({ where: { id: squatter.id } });
    await emailChange.confirmEmailChange({ token }, anonymous);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email).toBe(newAddress);
  });

  it('staff creation refuses an address a revert reserves', async () => {
    const { context } = await account();
    const reserved = (await prisma.user.findFirstOrThrow()).email;
    const newAddress = freshEmail();
    await emailChange.requestEmailChange(
      { newEmail: newAddress, currentPassword: PASSWORD },
      context,
    );
    const { token } = await lastMail(newAddress);
    await emailChange.confirmEmailChange({ token }, anonymous);
    const admin = await staffAccount(prisma, [SystemRole.SUPER_ADMIN]);
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    expect(
      (
        await errorOf(
          adminUsers.createStaffUser(
            { email: reserved, fullName: 'X', roleIds: [adminRole.id] },
            admin.context,
          ),
        )
      ).code,
    ).toBe('EMAIL_TAKEN');
  });
});

describe('delivery history', () => {
  it('lists an account’s mail newest first, and checks a claimed address with an audit row', async () => {
    const { email, userId } = await account();
    await passwords.requestPasswordReset({ email }, anonymous);
    await dispatcher.idle();
    const admin = await staffAccount(prisma, [SystemRole.ADMIN]);
    const { deliveries, page } = await adminUsers.listEmailDeliveries(
      { userId, page: { limit: 1, cursor: undefined } },
      admin.context,
    );
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      template: identityGrpc.EmailTemplate.EMAIL_TEMPLATE_PASSWORD_RESET,
      status: identityGrpc.EmailDeliveryStatus.EMAIL_DELIVERY_STATUS_SENT,
      bounceType: identityGrpc.EmailBounceType.EMAIL_BOUNCE_TYPE_UNSPECIFIED,
    });
    const next = await adminUsers.listEmailDeliveries(
      { userId, page: { limit: 1, cursor: page!.nextCursor } },
      admin.context,
    );
    expect(next.deliveries[0]?.template).toBe(
      identityGrpc.EmailTemplate.EMAIL_TEMPLATE_EMAIL_VERIFICATION,
    );
    expect(next.page?.nextCursor).toBeUndefined();

    expect(
      await adminUsers.checkEmailDelivery({ userId, email: email.toUpperCase() }, admin.context),
    ).toEqual({ matches: true });
    expect(
      await adminUsers.checkEmailDelivery({ userId, email: 'other@example.com' }, admin.context),
    ).toEqual({ matches: false });
    const checks = (await prisma.outboxEvent.findMany({ where: { subject: 'audit.record' } }))
      .map((row) => row.payload as { action: AuditAction; metadata: unknown })
      .filter((payload) => payload.action === AuditAction.EMAIL_ADDRESS_CHECKED);
    expect(checks.map((payload) => payload.metadata)).toEqual([
      { after: { matches: true } },
      { after: { matches: false } },
    ]);
    expect(JSON.stringify(checks)).not.toContain('@example.com');
  });
});
