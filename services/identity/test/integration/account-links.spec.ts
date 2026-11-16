import { ActionTokenPurpose, EmailTemplate, newId, SystemRole } from '@wayfare/contracts';
import type { RequestOrigin } from '@wayfare/nest-common';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';
import { errorOf, staffAccount } from '../setup/fixtures';
import { identityServices } from '../setup/services';

const prisma = testPrisma();
const { links, email } = identityServices(prisma);
const origin: RequestOrigin = { ip: '203.0.113.9', userAgent: 'links/1.0' };

beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

async function user(address = `u-${newId()}@example.com`) {
  const account = await staffAccount(prisma, [SystemRole.USER], { email: address });
  return { ...account, email: address };
}

const mint = (
  userId: string,
  targetEmail: string,
  purpose: ActionTokenPurpose = ActionTokenPurpose.PASSWORD_RESET,
) =>
  prisma.$transaction((tx) =>
    links.mint(tx, { userId, purpose, targetEmail, origin, now: new Date() }),
  );

const consume = (token: string, purposes = [ActionTokenPurpose.PASSWORD_RESET]) =>
  prisma.$transaction((tx) => links.consume(tx, token, purposes));

describe('AccountLinksService', () => {
  it('stores only the hash, the binding and the origin', async () => {
    const account = await user();
    const { id, token } = await mint(account.id, account.email);
    const row = await prisma.actionToken.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      userId: account.id,
      purpose: 'PASSWORD_RESET',
      targetEmail: account.email,
      ip: '203.0.113.9',
      userAgent: 'links/1.0',
      usedAt: null,
      invalidatedAt: null,
    });
    expect(row.tokenHash).toHaveLength(64);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeGreaterThan(3_590_000);
  });

  it('a new token of the same purpose supersedes the old one', async () => {
    const account = await user();
    const first = await mint(account.id, account.email);
    const verification = await mint(
      account.id,
      account.email,
      ActionTokenPurpose.EMAIL_VERIFICATION,
    );
    await mint(account.id, account.email);
    expect((await errorOf(consume(first.token))).code).toBe('TOKEN_EXPIRED');
    const old = await prisma.actionToken.findUniqueOrThrow({ where: { id: first.id } });
    expect(old.invalidatedAt).not.toBeNull();
    // Another purpose is untouched.
    await consume(verification.token, [ActionTokenPurpose.EMAIL_VERIFICATION]);
  });

  it('is single-use, even under concurrency', async () => {
    const account = await user();
    const { token } = await mint(account.id, account.email);
    const results = await Promise.allSettled([consume(token), consume(token)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await errorOf(consume(token))).code).toBe('TOKEN_EXPIRED');
  });

  it('refuses an expired token, a wrong purpose, and an unknown one', async () => {
    const account = await user();
    const { id, token } = await mint(account.id, account.email);
    expect((await errorOf(consume(token, [ActionTokenPurpose.ACCOUNT_SETUP]))).code).toBe(
      'TOKEN_EXPIRED',
    );
    expect((await errorOf(consume('nope'))).code).toBe('TOKEN_EXPIRED');
    await prisma.actionToken.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await links.inspect(prisma, token, [ActionTokenPurpose.PASSWORD_RESET])).toBeNull();
    expect((await errorOf(consume(token))).code).toBe('TOKEN_EXPIRED');
  });

  it('a link bound to an address the account no longer has is not live, and is not spent', async () => {
    const account = await user();
    const { id, token } = await mint(account.id, account.email);
    await prisma.user.update({ where: { id: account.id }, data: { email: 'moved@example.com' } });
    expect((await errorOf(consume(token))).code).toBe('TOKEN_EXPIRED');
    expect((await prisma.actionToken.findUniqueOrThrow({ where: { id } })).usedAt).toBeNull();
    // An address change and its revert are bound to another address by design.
    const change = await mint(account.id, 'new@example.com', ActionTokenPurpose.EMAIL_CHANGE);
    expect(
      await links.inspect(prisma, change.token, [ActionTokenPurpose.EMAIL_CHANGE]),
    ).not.toBeNull();
  });

  it("a deactivated account's links are dead, the revert included", async () => {
    const account = await user();
    const reset = await mint(account.id, account.email);
    const revert = await mint(
      account.id,
      'old@example.com',
      ActionTokenPurpose.EMAIL_CHANGE_REVERT,
    );
    await prisma.user.update({ where: { id: account.id }, data: { deletedAt: new Date() } });
    expect((await errorOf(consume(reset.token))).code).toBe('TOKEN_EXPIRED');
    expect(
      (await errorOf(consume(revert.token, [ActionTokenPurpose.EMAIL_CHANGE_REVERT]))).code,
    ).toBe('TOKEN_EXPIRED');
  });

  it('a live revert reserves its address and blocks the user, until it is used', async () => {
    const account = await user();
    const revert = await mint(
      account.id,
      'old@example.com',
      ActionTokenPurpose.EMAIL_CHANGE_REVERT,
    );
    expect(await links.liveRevertFor(prisma, { email: 'old@example.com' })).toBe(true);
    expect(await links.liveRevertFor(prisma, { userId: account.id })).toBe(true);
    expect(await links.liveRevertFor(prisma, { email: 'other@example.com' })).toBe(false);
    await consume(revert.token, [ActionTokenPurpose.EMAIL_CHANGE_REVERT]);
    expect(await links.liveRevertFor(prisma, { email: 'old@example.com' })).toBe(false);
  });
});

describe('schema objects', () => {
  it('action_tokens_live_revert_idx serves the reservation lookup', async () => {
    const account = await user();
    await mint(account.id, 'old@example.com', ActionTokenPurpose.EMAIL_CHANGE_REVERT);
    await mint(account.id, 'older@example.com', ActionTokenPurpose.EMAIL_CHANGE_REVERT);
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      return tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
        EXPLAIN SELECT id FROM action_tokens
        WHERE target_email = ${'old@example.com'} AND purpose = 'EMAIL_CHANGE_REVERT'
          AND used_at IS NULL AND invalidated_at IS NULL`;
    });
    expect(plan.map((line) => line['QUERY PLAN']).join('\n')).toContain(
      'action_tokens_live_revert_idx',
    );
  });

  it('email_deliveries_one_per_event holds for a recipient with no account', async () => {
    const eventId = newId();
    const insert = () =>
      prisma.$executeRaw`
        INSERT INTO email_deliveries (id, template, recipient_user_id, event_id, provider, status)
        VALUES (${newId()}::uuid, 'STAFF_INVITE', NULL, ${eventId}::uuid, 'RESEND', 'QUEUED')`;
    await insert();
    const failure = await insert().then(
      () => null,
      (error: unknown) => JSON.stringify(error, Object.getOwnPropertyNames(error)),
    );
    expect(failure).toContain('email_deliveries_one_per_event');
    // And prepare, for the same event and no account, finds the row instead of failing.
    const pending = await email.prepare(prisma, {
      template: EmailTemplate.STAFF_INVITE,
      eventId,
      recipient: { email: 'invitee@example.com' },
      data: { membershipId: newId(), sellerName: 'Cafe', expiresAt: new Date().toISOString() },
      links: { action: { path: 'verifyEmail' } },
    });
    expect(pending).not.toBeNull();
    expect(await prisma.emailDelivery.count()).toBe(1);
  });
});
