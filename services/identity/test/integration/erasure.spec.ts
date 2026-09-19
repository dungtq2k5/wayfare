// Erasure (api-endpoints-plan §1.3, rdm-spec I-1): the refusals, everything one transaction changes,
// what it keeps, and the address freed for a new account.
import {
  AUDIT_RECORD,
  AuditAction,
  EmailTemplate,
  IDENTITY_USER_ERASED,
  LEGAL_DOCUMENT_VERSIONS,
  newId,
  OwnerRegistrationStatus,
} from '@wayfare/contracts';
import { rpcError } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { buildAccountContext, buildAnonymousContext } from '@wayfare/nest-common/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ErasureBlockers } from '../../src/modules/billing-port/billing-port.service';
import { testPrisma, truncateAll } from '../setup/database';
import {
  CLIENT,
  errorCodeOf,
  errorOf,
  PASSWORD,
  registerAccount,
  registerDevice,
  staffAccount,
} from '../setup/fixtures';
import { identityServices } from '../setup/services';

const prisma = testPrisma();
const CLEAR: ErasureBlockers = {
  pendingBuyerOrder: false,
  activeSubscription: false,
  subscriptionEndsAt: null,
  issuedVouchersSold: 0,
  openDisputes: 0,
};
let blockers: ErasureBlockers | 'down' = CLEAR;
const services = identityServices(
  prisma,
  {},
  {
    billing: {
      getErasureBlockers: async () => {
        await Promise.resolve();
        if (blockers === 'down') throw rpcError('UPSTREAM_UNAVAILABLE');
        return blockers;
      },
    },
  },
);
const { users } = services;

beforeEach(async () => {
  await truncateAll(prisma);
  blockers = CLEAR;
});
afterAll(() => prisma.$disconnect());

const erase = (context: AccountContext, currentPassword = PASSWORD) =>
  users.eraseMe({ currentPassword }, context);

async function person(options: Parameters<typeof registerAccount>[1] = {}) {
  const { email, session } = await registerAccount(services, options);
  const userId = session.user!.id;
  return { email, session, userId, context: buildAccountContext({ userId }) };
}

async function outbox(subject: string): Promise<Record<string, unknown>[]> {
  const rows = await prisma.outboxEvent.findMany({ where: { subject }, orderBy: { id: 'asc' } });
  return rows.map((row) => row.payload as Record<string, unknown>);
}

const untouched = async (userId: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).erasedAt === null;

describe('refusals', () => {
  it('a wrong password is INVALID_CREDENTIALS, and nothing changes', async () => {
    const { userId, context } = await person();
    expect(await errorCodeOf(erase(context, 'not the password'))).toBe('INVALID_CREDENTIALS');
    expect(await untouched(userId)).toBe(true);
  });

  it('billing unreachable is UPSTREAM_UNAVAILABLE for a tourist too', async () => {
    const { userId, context } = await person();
    blockers = 'down';
    expect(await errorCodeOf(erase(context))).toBe('UPSTREAM_UNAVAILABLE');
    expect(await untouched(userId)).toBe(true);
  });

  it('refuses a pending order, and an owner obligation with the paid period end', async () => {
    const { userId, context } = await person();
    blockers = { ...CLEAR, pendingBuyerOrder: true };
    expect(await errorCodeOf(erase(context))).toBe('BUYER_HAS_PENDING_ORDER');
    blockers = {
      ...CLEAR,
      activeSubscription: true,
      subscriptionEndsAt: new Date('2026-10-19T10:00:00.000Z'),
    };
    expect(await errorOf(erase(context))).toEqual({
      code: 'OWNER_HAS_ACTIVE_OBLIGATIONS',
      details: { subscriptionEndsAt: '2026-10-19T10:00:00.000Z' },
    });
    blockers = { ...CLEAR, activeSubscription: true };
    expect(await errorOf(erase(context))).toMatchObject({
      code: 'OWNER_HAS_ACTIVE_OBLIGATIONS',
      details: {},
    });
    expect(await untouched(userId)).toBe(true);
  });

  it('refuses while an email-change revert link is live', async () => {
    const { userId, context } = await person();
    await prisma.actionToken.create({
      data: {
        userId,
        purpose: 'EMAIL_CHANGE_REVERT',
        tokenHash: 'a'.repeat(64),
        targetEmail: 'old@example.com',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(await errorCodeOf(erase(context))).toBe('EMAIL_CHANGE_REVERT_PENDING');
    expect(await untouched(userId)).toBe(true);
  });

  it('keeps the last active super admin, also when two erase at once', async () => {
    const passwordHash = await services.tokens.hashPassword(PASSWORD);
    const only = await staffAccount(prisma, ['SUPER_ADMIN'], { passwordHash });
    expect(await errorCodeOf(erase(only.context))).toBe('LAST_SUPER_ADMIN');

    const second = await staffAccount(prisma, ['SUPER_ADMIN'], { passwordHash });
    // A success makes errorCodeOf throw; it is recorded as OK.
    const attempt = (context: AccountContext) => errorCodeOf(erase(context)).catch(() => 'OK');
    const codes = await Promise.all([attempt(only.context), attempt(second.context)]);
    expect(codes.toSorted()).toEqual(['LAST_SUPER_ADMIN', 'OK']);
    expect(await prisma.user.count({ where: { erasedAt: { not: null } } })).toBe(1);
  });
});

describe('the erasure', () => {
  it('stops the account being a person, in one transaction', async () => {
    const device = await registerDevice(services);
    const { email, session, userId, context } = await person({
      client: CLIENT.mobile,
      context: device.context,
    });
    // A bounced address, a live link, a notification, a delivery and a session with its origin.
    await prisma.user.update({
      where: { id: userId },
      data: { fullName: 'Ann Lee', emailBouncedAt: new Date() },
    });
    await services.passwords.requestPasswordReset({ email }, buildAnonymousContext());
    await services.dispatcher.idle();
    await prisma.notification.create({
      data: {
        id: newId(),
        recipientUserId: userId,
        type: 'OWNER_REGISTRATION_APPROVED',
        data: {},
        eventId: newId(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await prisma.session.updateMany({
      where: { userId },
      data: { ip: '203.0.113.9', userAgent: 'Wayfare/1.0' },
    });

    await erase({ ...context, deviceId: device.deviceId });

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row).toMatchObject({
      email: `erased+${userId}@invalid.wayfare.app`,
      passwordHash: null,
      fullName: null,
      isEmailVerified: false,
      emailBouncedAt: null,
    });
    expect(row.erasedAt).not.toBeNull();
    expect(row.deletedAt).toEqual(row.erasedAt);
    expect(row.tokensValidAfter).toEqual(row.erasedAt);
    const sessions = await prisma.session.findMany({ where: { userId } });
    expect(sessions.every((s) => s.revokedAt !== null && s.revokedReason === 'ERASED')).toBe(true);
    expect(sessions.every((s) => s.ip === null && s.userAgent === null)).toBe(true);
    expect(await prisma.device.findUniqueOrThrow({ where: { id: device.deviceId } })).toMatchObject(
      { userId: null, claimedAt: null },
    );
    expect(await prisma.actionToken.count({ where: { userId } })).toBe(0);
    expect(await prisma.notification.count({ where: { recipientUserId: userId } })).toBe(0);
    const deliveries = await prisma.emailDelivery.findMany({ where: { recipientUserId: userId } });
    expect(deliveries.length).toBeGreaterThan(0);
    expect(deliveries.every((d) => d.toEmailMasked === null && d.toEmailHash === null)).toBe(true);
    // Kept: the evidence of what was agreed and done, IPs included, pointing at the id.
    expect(await prisma.legalAcceptance.count({ where: { userId } })).toBeGreaterThan(0);
    expect(await prisma.userRole.count({ where: { userId } })).toBe(1);

    const audits = (await outbox(AUDIT_RECORD.subject)).filter(
      (payload) => payload.action === AuditAction.USER_ERASED,
    );
    expect(audits).toEqual([
      expect.objectContaining({ resource: { type: 'USER', id: userId }, metadata: {} }),
    ]);
    expect(await outbox(IDENTITY_USER_ERASED.subject)).toEqual([
      expect.objectContaining({ userId }),
    ]);
    // The old refresh token is refused; a second call finds nobody.
    expect(
      await errorCodeOf(
        services.auth.refresh(
          { refreshToken: session.refreshToken, client: CLIENT.mobile },
          device.context,
        ),
      ),
    ).toBe('UNAUTHENTICATED');
    expect(await errorCodeOf(erase(context))).toBe('UNAUTHENTICATED');
  });

  it('frees the address: the same one registers a new account', async () => {
    const { email, userId, context } = await person();
    await erase(context);
    const again = await person({ email });
    expect(again.userId).not.toBe(userId);
  });

  it('sends nothing afterwards, not even a crash-resend of a queued mail', async () => {
    const { userId, context } = await person();
    const eventId = newId();
    const pending = await prisma.$transaction((tx) =>
      services.email.prepare(tx, {
        template: EmailTemplate.PAYMENT_FAILED,
        eventId,
        recipient: { userId },
        data: { attemptCount: 1 },
        links: {},
      }),
    );
    expect(pending).not.toBeNull();
    await erase(context);
    const resend = await prisma.$transaction((tx) =>
      services.email.prepare(tx, {
        template: EmailTemplate.PAYMENT_FAILED,
        eventId,
        recipient: { userId },
        data: { attemptCount: 1 },
        links: {},
      }),
    );
    expect(resend).toBeNull();
    const fresh = await prisma.$transaction((tx) =>
      services.email.prepare(tx, {
        template: EmailTemplate.PAYMENT_FAILED,
        eventId: newId(),
        recipient: { userId },
        data: { attemptCount: 2 },
        links: {},
      }),
    );
    expect(fresh).toBeNull();
  });

  it("clears an applicant's application, withdrawing an open one", async () => {
    const { userId, context } = await person();
    await prisma.user.update({ where: { id: userId }, data: { isEmailVerified: true } });
    await services.registrations.submitRegistration(
      {
        businessName: 'Quán thử',
        businessAddress: '12 Lê Lợi',
        contactName: 'An',
        contactPhone: '+84901234567',
        nationalId: '079201001234',
        applicantNote: 'The stall at the corner.',
        ownerAgreementVersion: LEGAL_DOCUMENT_VERSIONS.OWNER_AGREEMENT,
      },
      context,
    );
    await erase(context);
    expect(await prisma.ownerRegistration.findFirstOrThrow({ where: { userId } })).toMatchObject({
      status: OwnerRegistrationStatus.WITHDRAWN,
      nationalIdCiphertext: null,
      nationalIdLast4: null,
      contactName: '',
      contactPhone: '',
      applicantNote: null,
      businessName: 'Quán thử',
    });
  });
});
