// The development seeds (ADR 0002): dev-plans' local prices without a Stripe key, and the Vĩnh Khánh
// owners put on their plans by synthetic events through billing's own webhook processing.
import { BILLING_ENTITLEMENTS_CHANGED, BillingEventStatus } from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assertNotProduction, seedDevPlans } from '../../prisma/seed/dev-plans.seed';
import {
  loadPilotPlans,
  seedPilotD4Plans,
  waitForAccounts,
} from '../../prisma/seed/pilot-d4-plans.seed';
import { outboxPayloads, testPrisma, truncateAll } from '../setup/database';
import { billingServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof billingServices>;
// A slice: one owner per plan.
const slice = loadPilotPlans().filter((plan) =>
  ['owner-1', 'owner-3', 'owner-4'].includes(plan.ownerSlug),
);

beforeEach(async () => {
  await truncateAll(prisma);
  services = billingServices(prisma);
});
afterAll(() => prisma.$disconnect());

const openAccounts = () =>
  prisma.$transaction(async (tx) => {
    for (const plan of slice) {
      await services.entitlements.openFreeAccount(tx, plan.ownerUserId, new Date());
    }
  });

const seed = () =>
  seedPilotD4Plans({ prisma, webhooks: services.webhooks }, slice, { liveMode: false });

describe('dev-plans without a Stripe key', () => {
  it('creates the paid plans with local prices at the product amounts, once', async () => {
    const first = await seedDevPlans(prisma, {});
    expect(first).toContain('created GROWTH');
    const prices = await prisma.planPrice.findMany({
      where: { stripePriceId: { startsWith: 'price_dev_' } },
      select: { stripePriceId: true, amountMinor: true, isActive: true },
      orderBy: { stripePriceId: 'asc' },
    });
    expect(prices).toEqual([
      { stripePriceId: 'price_dev_growth_month', amountMinor: 900, isActive: true },
      { stripePriceId: 'price_dev_growth_year', amountMinor: 9000, isActive: true },
      { stripePriceId: 'price_dev_pro_month', amountMinor: 2900, isActive: true },
      { stripePriceId: 'price_dev_pro_year', amountMinor: 29000, isActive: true },
    ]);
    expect(await seedDevPlans(prisma, {})).toEqual(['GROWTH present', 'PRO present']);
    expect(await prisma.planPrice.count()).toBe(4);
  });
});

describe('the Vĩnh Khánh plans seed', () => {
  it('subscribes each paid owner through webhook processing; a second run writes nothing', async () => {
    await seedDevPlans(prisma, {});
    await openAccounts();
    const first = await seed();
    expect(first).toEqual([
      'subscribed owner-1 to GROWTH (sub_seed_owner-1, synthetic)',
      'subscribed owner-3 to PRO (sub_seed_owner-3, synthetic)',
      'unchanged owner-4 (FREE)',
    ]);
    const accounts = await prisma.billingAccount.findMany({
      select: {
        ownerUserId: true,
        stripeCustomerId: true,
        plan: { select: { code: true } },
        stripeSubscriptionId: true,
        subscriptionStatus: true,
      },
    });
    const of = (slug: string) =>
      accounts.find(
        (row) => row.ownerUserId === slice.find((p) => p.ownerSlug === slug)!.ownerUserId,
      );
    expect(of('owner-1')).toMatchObject({
      stripeCustomerId: 'cus_seed_owner-1',
      plan: { code: 'GROWTH' },
      stripeSubscriptionId: 'sub_seed_owner-1',
      subscriptionStatus: 'ACTIVE',
    });
    expect(of('owner-3')?.plan.code).toBe('PRO');
    expect(of('owner-4')).toMatchObject({
      plan: { code: 'FREE' },
      stripeSubscriptionId: null,
      subscriptionStatus: 'NONE',
    });
    expect(
      await prisma.billingEvent.count({ where: { status: BillingEventStatus.PROCESSED } }),
    ).toBe(4);

    const changed = (await outboxPayloads(prisma, BILLING_ENTITLEMENTS_CHANGED.subject)).length;
    const outbox = await prisma.outboxEvent.count();
    expect(await seed()).toEqual([
      'unchanged owner-1 (GROWTH)',
      'unchanged owner-3 (PRO)',
      'unchanged owner-4 (FREE)',
    ]);
    expect(await prisma.outboxEvent.count()).toBe(outbox);
    expect(await outboxPayloads(prisma, BILLING_ENTITLEMENTS_CHANGED.subject)).toHaveLength(changed);
    expect(await prisma.billingEvent.count()).toBe(4);
  });

  it('refuses a production environment', () => {
    expect(() => assertNotProduction({ NODE_ENV: 'production' })).toThrow(/NODE_ENV=production/);
  });

  it('refuses a live Stripe mode before writing anything', async () => {
    await expect(
      seedPilotD4Plans({ prisma, webhooks: services.webhooks }, slice, { liveMode: true }),
    ).rejects.toThrow(/refuses a live Stripe mode/);
    expect(await prisma.billingEvent.count()).toBe(0);
  });

  it('says which owners have no account yet when identity never verified them', async () => {
    await expect(
      waitForAccounts(
        prisma,
        slice.map((plan) => plan.ownerUserId),
        { timeoutMs: 200, intervalMs: 50 },
      ),
    ).rejects.toThrow(
      new RegExp(`still missing for ${slice[0]!.ownerUserId}.*Are identity and billing running`),
    );
  });

  it('asks for dev-plans first when a paid plan has no price', async () => {
    await openAccounts();
    await expect(seed()).rejects.toThrow(/run billing's dev-plans first/);
  });
});
