// Erasure (api-endpoints-plan §1.3, §10): what billing says before identity erases an account, the
// Checkout expiry that bounds it, and the Stripe customer forgetting the person afterwards.
import { IDENTITY_USER_ERASED, newId, SubscriptionStatus } from '@wayfare/contracts';
import { fromProtoTimestamp } from '@wayfare/nest-common';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';
import { owner, paidPlan } from '../setup/fixtures';
import { billingServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof billingServices>;

beforeEach(async () => {
  await truncateAll(prisma);
  services = billingServices(prisma);
});
afterAll(() => prisma.$disconnect());

const blockers = (userId: string) => services.seller.getErasureBlockers({ userId });

describe('GetErasureBlockers', () => {
  it('is clear for a user billing has no account for, and for an owner on FREE', async () => {
    expect(await blockers(newId())).toEqual({
      pendingBuyerOrder: false,
      activeSubscription: false,
      subscriptionEndsAt: undefined,
      issuedVouchersSold: 0,
      openDisputes: 0,
    });
    const account = await owner(services, prisma);
    expect((await blockers(account.ownerUserId)).activeSubscription).toBe(false);
  });

  it('blocks every subscription that can still charge, with the end of a cancelled one', async () => {
    const account = await owner(services, prisma);
    const end = new Date('2026-10-19T10:00:00.000Z');
    for (const status of [
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.INCOMPLETE,
      SubscriptionStatus.UNPAID,
      SubscriptionStatus.PAUSED,
    ]) {
      await prisma.billingAccount.update({
        where: { id: account.accountId },
        data: { subscriptionStatus: status, currentPeriodEnd: end },
      });
      const answer = await blockers(account.ownerUserId);
      expect(answer.activeSubscription, status).toBe(true);
      expect(answer.subscriptionEndsAt).toBeUndefined();
    }
    await prisma.billingAccount.update({
      where: { id: account.accountId },
      data: { cancelAtPeriodEnd: true },
    });
    expect(
      fromProtoTimestamp(
        (await blockers(account.ownerUserId)).subscriptionEndsAt,
        '/subscriptionEndsAt',
      ),
    ).toEqual(end);
    await prisma.billingAccount.update({
      where: { id: account.accountId },
      data: { subscriptionStatus: SubscriptionStatus.CANCELED },
    });
    expect(await blockers(account.ownerUserId)).toMatchObject({
      activeSubscription: false,
      subscriptionEndsAt: undefined,
    });
  });

  it('blocks while a Checkout page is open: the session expires in about half an hour', async () => {
    const account = await owner(services, prisma);
    const growth = await paidPlan(prisma, 'GROWTH');
    const before = Date.now();
    await services.subscriptions.createCheckoutSession(
      { planPriceId: growth.priceId, idempotencyKey: newId() },
      account.context,
    );
    const expiresAt = services.payments.checkouts[0]!.expiresAt.getTime();
    expect(expiresAt - before).toBeGreaterThan(30 * 60_000);
    expect(expiresAt - before).toBeLessThanOrEqual(36 * 60_000);
    const stored = await prisma.billingAccount.findUniqueOrThrow({
      where: { id: account.accountId },
    });
    expect(stored.checkoutOpenUntil?.getTime()).toBe(expiresAt);
    expect((await blockers(account.ownerUserId)).activeSubscription).toBe(true);

    await prisma.billingAccount.update({
      where: { id: account.accountId },
      data: { checkoutOpenUntil: new Date(Date.now() - 1) },
    });
    expect((await blockers(account.ownerUserId)).activeSubscription).toBe(false);
  });
});

describe('identity.user.erased', () => {
  const erased = (userId: string, eventId = newId()) =>
    IDENTITY_USER_ERASED.schema.parse({ eventId, occurredAt: new Date().toISOString(), userId });

  it('redacts the Stripe customer once, and keeps the account', async () => {
    const account = await owner(services, prisma);
    await prisma.billingAccount.update({
      where: { id: account.accountId },
      data: { stripeCustomerId: 'cus_erased' },
    });
    const payload = erased(account.ownerUserId);
    await services.userErased.handle(payload);
    await services.userErased.handle(payload);
    expect(services.payments.redacted).toEqual(['cus_erased']);
    expect(await prisma.billingAccount.count({ where: { id: account.accountId } })).toBe(1);
  });

  it('has nothing to do without a customer, or for a user billing never knew', async () => {
    const account = await owner(services, prisma);
    await services.userErased.handle(erased(account.ownerUserId));
    await services.userErased.handle(erased(newId()));
    expect(services.payments.calls).toEqual([]);
  });

  it('throws on a Stripe failure, so the event comes back, and succeeds on the redelivery', async () => {
    const account = await owner(services, prisma);
    await prisma.billingAccount.update({
      where: { id: account.accountId },
      data: { stripeCustomerId: 'cus_retry' },
    });
    const payload = erased(account.ownerUserId);
    services.payments.unavailable = true;
    await expect(services.userErased.handle(payload)).rejects.toThrow();
    expect(await prisma.processedEvent.count()).toBe(0);
    services.payments.unavailable = false;
    await services.userErased.handle(payload);
    expect(services.payments.redacted).toEqual(['cus_retry']);
  });

  it('acknowledges without a key: there is no Stripe to reach', async () => {
    const account = await owner(services, prisma);
    await prisma.billingAccount.update({
      where: { id: account.accountId },
      data: { stripeCustomerId: 'cus_nokey' },
    });
    services.payments.configured = false;
    await services.userErased.handle(erased(account.ownerUserId));
    expect(services.payments.calls).toEqual([]);
    expect(await prisma.processedEvent.count()).toBe(1);
  });
});
