// The plan catalogue (api-endpoints-plan §6.1, rdm-spec B-1, B-2): every grant stated, prices read
// from Stripe, apply as the explicit fan-out with a dry run, and retirement refused while in use.
import {
  AUDIT_RECORD,
  AuditAction,
  BILLING_ENTITLEMENTS_CHANGED,
  SubscriptionStatus,
} from '@wayfare/contracts';
import { billingGrpc } from '@wayfare/contracts/grpc';
import { buildAccountContext } from '@wayfare/nest-common/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { outboxPayloads, testPrisma, truncateAll } from '../setup/database';
import { errorOf, GROWTH_GRANTS, owner, paidPlan } from '../setup/fixtures';
import { billingServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof billingServices>;
const admin = buildAccountContext();

beforeEach(async () => {
  await truncateAll(prisma);
  services = billingServices(prisma);
});
afterAll(() => prisma.$disconnect());

const wireGrants = (over: Partial<billingGrpc.Entitlements> = {}): billingGrpc.Entitlements => ({
  ...GROWTH_GRANTS,
  narrationLanguageScope: billingGrpc.NarrationLanguageScope.NARRATION_LANGUAGE_SCOPE_LAUNCH,
  analyticsLevel: billingGrpc.AnalyticsLevel.ANALYTICS_LEVEL_BASIC,
  voucherCommissionBps: 1500,
  ...over,
});

const freePlanId = async () =>
  (await prisma.plan.findFirstOrThrow({ where: { code: 'FREE' }, select: { id: true } })).id;

describe('plans', () => {
  it('creates a plan with every grant, within ceilings, and refuses a taken code', async () => {
    const { plan } = await services.plans.createPlan(
      { code: 'GROWTH', name: 'Growth', sortOrder: 10, grants: wireGrants() },
      admin,
    );
    expect(plan).toMatchObject({ code: 'GROWTH', subscriberCount: 0, isActive: true });
    expect(
      (
        await errorOf(
          services.plans.createPlan(
            { code: 'GROWTH', name: 'Again', sortOrder: 11, grants: wireGrants() },
            admin,
          ),
        )
      ).details,
    ).toEqual({ issues: [{ path: '/code', code: 'taken' }] });
    const tooWide = await errorOf(
      services.plans.createPlan(
        { code: 'WIDE', name: 'Wide', sortOrder: 12, grants: wireGrants({ maxPlaces: 500 }) },
        admin,
      ),
    );
    expect(tooWide.code).toBe('VALIDATION_FAILED');
    const missing = await errorOf(
      services.plans.createPlan(
        { code: 'BARE', name: 'Bare', sortOrder: 13, grants: undefined },
        admin,
      ),
    );
    expect(missing.code).toBe('VALIDATION_FAILED');
    const created = (await outboxPayloads(prisma, AUDIT_RECORD.subject)).filter(
      (payload) => payload.action === AuditAction.PLAN_CREATED,
    );
    expect(created).toEqual([
      expect.objectContaining({ metadata: { after: { code: 'GROWTH', grants: GROWTH_GRANTS } } }),
    ]);
  });

  it('registers a price from Stripe, deactivating the previous one for the interval', async () => {
    const { plan } = await services.plans.createPlan(
      { code: 'GROWTH', name: 'Growth', sortOrder: 10, grants: wireGrants() },
      admin,
    );
    const stripePrice = (id: string, amount: number) => ({
      id,
      active: true,
      currency: 'usd',
      unitAmount: amount,
      recurringInterval: 'month',
      productId: 'prod_growth',
    });
    services.payments.prices.set('price_a', stripePrice('price_a', 900));
    services.payments.prices.set('price_b', stripePrice('price_b', 1000));
    services.payments.prices.set('price_y', {
      ...stripePrice('price_y', 9000),
      recurringInterval: 'year',
    });
    const month = billingGrpc.BillingInterval.BILLING_INTERVAL_MONTH;
    await services.plans.registerPrice(
      { planId: plan!.id, stripePriceId: 'price_a', billingInterval: month },
      admin,
    );
    const { plan: after } = await services.plans.registerPrice(
      { planId: plan!.id, stripePriceId: 'price_b', billingInterval: month },
      admin,
    );
    expect(after?.stripeProductId).toBe('prod_growth');
    expect(
      after?.prices.map((price) => [price.stripePriceId, price.isActive, price.amountMinor]),
    ).toEqual([
      ['price_b', true, 1000],
      ['price_a', false, 900],
    ]);
    // Each says when it was registered; the replaced one when it was replaced.
    const [current, replaced] = after!.prices;
    expect(current!.createdAt).toBeDefined();
    expect(current!.replacedAt).toBeUndefined();
    expect(replaced!.replacedAt).toBeDefined();
    expect(
      (
        await errorOf(
          services.plans.registerPrice(
            { planId: plan!.id, stripePriceId: 'price_y', billingInterval: month },
            admin,
          ),
        )
      ).details,
    ).toEqual({ issues: [{ path: '/billingInterval', code: 'interval_mismatch' }] });
    // FREE is assigned, never sold.
    expect(
      (
        await errorOf(
          services.plans.registerPrice(
            { planId: await freePlanId(), stripePriceId: 'price_a', billingInterval: month },
            admin,
          ),
        )
      ).code,
    ).toBe('INVALID_STATE');
    services.payments.unavailable = true;
    expect(
      (
        await errorOf(
          services.plans.registerPrice(
            { planId: plan!.id, stripePriceId: 'price_b', billingInterval: month },
            admin,
          ),
        )
      ).code,
    ).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('applies a plan with a dry run first: the same projection, no writes, pinned skipped', async () => {
    const growth = await paidPlan(prisma, 'GROWTH');
    const accounts = [];
    for (let i = 0; i < 3; i++) {
      const account = await owner(services, prisma);
      await prisma.billingAccount.update({
        where: { id: account.accountId },
        data: {
          planId: growth.planId,
          planPriceId: growth.priceId,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
          maxPlaces: 10,
        },
      });
      services.catalog.counts.set(account.ownerUserId, 8);
      accounts.push(account);
    }
    await prisma.billingAccount.update({
      where: { id: accounts[2]!.accountId },
      data: { entitlementsPinned: true },
    });
    await services.plans.updatePlan(
      { planId: growth.planId, grants: wireGrants({ maxPlaces: 5 }) },
      admin,
    );
    const eventsBefore = (await outboxPayloads(prisma, BILLING_ENTITLEMENTS_CHANGED.subject))
      .length;
    const dry = await services.plans.applyPlan({ planId: growth.planId, dryRun: true }, admin);
    expect(dry).toMatchObject({
      dryRun: true,
      affected: 2,
      skippedPinned: 1,
      failed: 0,
      wouldUnpublishPlaces: 6,
      wouldEndBoosts: 0,
    });
    expect((await outboxPayloads(prisma, BILLING_ENTITLEMENTS_CHANGED.subject)).length).toBe(
      eventsBefore,
    );
    const applied = await services.plans.applyPlan({ planId: growth.planId, dryRun: false }, admin);
    expect(applied).toMatchObject({ dryRun: false, affected: 2, skippedPinned: 1 });
    expect((await outboxPayloads(prisma, BILLING_ENTITLEMENTS_CHANGED.subject)).length).toBe(
      eventsBefore + 2,
    );
    expect(
      (await prisma.billingAccount.findUniqueOrThrow({ where: { id: accounts[2]!.accountId } }))
        .maxPlaces,
    ).toBe(10);
    // Applying again changes nothing, so it publishes nothing.
    const again = await services.plans.applyPlan({ planId: growth.planId, dryRun: false }, admin);
    expect(again.affected).toBe(0);

    services.catalog.down = true;
    const blind = await services.plans.applyPlan({ planId: growth.planId, dryRun: true }, admin);
    expect(blind.wouldUnpublishPlaces).toBeUndefined();
  });

  it('reaches a cancelled owner when FREE is edited and applied', async () => {
    const growth = await paidPlan(prisma, 'GROWTH');
    const cancelled = await owner(services, prisma);
    await prisma.billingAccount.update({
      where: { id: cancelled.accountId },
      data: { planPriceId: growth.priceId, subscriptionStatus: SubscriptionStatus.CANCELED },
    });
    const free = await freePlanId();
    await services.plans.updatePlan(
      {
        planId: free,
        grants: wireGrants({
          maxPlaces: 2,
          autoNarration: false,
          narrationLanguageScope: billingGrpc.NarrationLanguageScope.NARRATION_LANGUAGE_SCOPE_BASIC,
          maxPhotosPerPlace: 3,
          maxMenuItemsPerPlace: 10,
          discoveryBoostSlots: 0,
          aiCreditsPerDay: 0,
          analyticsLevel: billingGrpc.AnalyticsLevel.ANALYTICS_LEVEL_NONE,
          canSellVouchers: false,
          voucherCommissionBps: undefined,
        }),
      },
      admin,
    );
    const applied = await services.plans.applyPlan({ planId: free, dryRun: false }, admin);
    expect(applied.affected).toBe(1);
    expect(
      await prisma.billingAccount.findUniqueOrThrow({
        where: { id: cancelled.accountId },
        select: { maxPlaces: true, planId: true },
      }),
    ).toEqual({ maxPlaces: 2, planId: free });
  });

  it('refuses to retire a plan with subscribers, or FREE; retires an unused one', async () => {
    const growth = await paidPlan(prisma, 'GROWTH');
    const pro = await paidPlan(prisma, 'PRO');
    const subscriber = await owner(services, prisma);
    await prisma.billingAccount.update({
      where: { id: subscriber.accountId },
      data: { planId: growth.planId },
    });
    expect((await errorOf(services.plans.retirePlan({ planId: growth.planId }, admin))).code).toBe(
      'PLAN_HAS_SUBSCRIBERS',
    );
    expect(
      (await errorOf(services.plans.retirePlan({ planId: await freePlanId() }, admin))).code,
    ).toBe('INVALID_STATE');
    await services.plans.retirePlan({ planId: pro.planId }, admin);
    const { plans } = await services.plans.listPlans({}, admin);
    expect(plans.map((plan) => [plan.code, plan.subscriberCount])).toEqual([
      ['FREE', 0],
      ['GROWTH', 1],
    ]);
  });

  it("counts a plan's subscribers by state, lists retired plans on request, reads one", async () => {
    const growth = await paidPlan(prisma, 'GROWTH');
    const states: {
      subscriptionStatus: SubscriptionStatus;
      cancelAtPeriodEnd?: boolean;
      entitlementsPinned?: boolean;
    }[] = [
      { subscriptionStatus: SubscriptionStatus.ACTIVE },
      { subscriptionStatus: SubscriptionStatus.TRIALING, entitlementsPinned: true },
      { subscriptionStatus: SubscriptionStatus.PAST_DUE },
      { subscriptionStatus: SubscriptionStatus.ACTIVE, cancelAtPeriodEnd: true },
      // A deactivated owner's account still counts in the total (billing can't tell).
      { subscriptionStatus: SubscriptionStatus.CANCELED },
    ];
    for (const state of states) {
      const { accountId } = await owner(services, prisma);
      await prisma.billingAccount.update({
        where: { id: accountId },
        data: { planId: growth.planId, ...state },
        select: { id: true },
      });
    }
    const { plan } = await services.plans.getPlan({ planId: growth.planId }, admin);
    expect(plan).toMatchObject({
      subscriberCount: 5,
      subscribers: { active: 3, pastDue: 1, cancelling: 1, pinned: 1 },
    });
    expect(plan?.createdAt).toBeDefined();
    expect(plan?.retiredAt).toBeUndefined();

    const { plan: unused } = await services.plans.createPlan(
      { code: 'OLD', name: 'Old', sortOrder: 30, grants: wireGrants() },
      admin,
    );
    await services.plans.retirePlan({ planId: unused!.id }, admin);
    expect((await services.plans.listPlans({}, admin)).plans.map((row) => row.code)).not.toContain(
      'OLD',
    );
    const withRetired = await services.plans.listPlans({ includeRetired: true }, admin);
    expect(withRetired.plans.find((row) => row.code === 'OLD')?.retiredAt).toBeDefined();
    // A retired plan has no page.
    expect((await errorOf(services.plans.getPlan({ planId: unused!.id }, admin))).code).toBe(
      'RESOURCE_NOT_FOUND',
    );
  });

  it("looks a price up with registering's checks, writing nothing", async () => {
    const { plan } = await services.plans.createPlan(
      { code: 'GROWTH', name: 'Growth', sortOrder: 10, grants: wireGrants() },
      admin,
    );
    const other = await paidPlan(prisma, 'PRO');
    const price = (id: string, over: Record<string, unknown> = {}) => ({
      id,
      active: true,
      currency: 'usd',
      unitAmount: 900,
      recurringInterval: 'month',
      productId: 'prod_growth',
      ...over,
    });
    services.payments.prices.set('price_first', price('price_first'));
    services.payments.prices.set('price_next', price('price_next', { unitAmount: 1200 }));
    services.payments.prices.set(
      'price_theirs',
      price('price_theirs', {
        productId: (
          await prisma.plan.findUniqueOrThrow({
            where: { id: other.planId },
            select: { stripeProductId: true },
          })
        ).stripeProductId!,
      }),
    );
    const month = billingGrpc.BillingInterval.BILLING_INTERVAL_MONTH;
    const lookup = (stripePriceId: string) =>
      services.plans.lookupPrice(
        { planId: plan!.id, stripePriceId, billingInterval: month },
        admin,
      );

    expect(await lookup('price_first')).toEqual({
      amountMinor: 900,
      currency: 'USD',
      billingInterval: month,
      productId: 'prod_growth',
    });
    expect(await prisma.planPrice.count({ where: { planId: plan!.id } })).toBe(0);
    expect(
      (await outboxPayloads(prisma, AUDIT_RECORD.subject)).filter(
        (payload) => payload.action === AuditAction.PLAN_PRICE_REGISTERED,
      ),
    ).toEqual([]);

    await services.plans.registerPrice(
      { planId: plan!.id, stripePriceId: 'price_first', billingInterval: month },
      admin,
    );
    expect(await lookup('price_next')).toMatchObject({
      amountMinor: 1200,
      replaces: { stripePriceId: 'price_first', amountMinor: 900, isActive: true },
    });
    const refusal = async (stripePriceId: string) => (await errorOf(lookup(stripePriceId))).details;
    expect(await refusal('price_unknown')).toEqual({
      issues: [{ path: '/stripePriceId', code: 'not_found' }],
    });
    // Already registered; another plan's product. Both checked before any write.
    expect(await refusal('price_first')).toEqual({
      issues: [{ path: '/stripePriceId', code: 'taken' }],
    });
    expect(await refusal('price_theirs')).toEqual({
      issues: [{ path: '/stripePriceId', code: 'product_mismatch' }],
    });
    expect(
      (
        await errorOf(
          services.plans.registerPrice(
            { planId: plan!.id, stripePriceId: 'price_unknown', billingInterval: month },
            admin,
          ),
        )
      ).details,
    ).toEqual({ issues: [{ path: '/stripePriceId', code: 'not_found' }] });
  });

  it('takes a price whose product another plan holds as taken, while this plan has none', async () => {
    const { plan } = await services.plans.createPlan(
      { code: 'NEW', name: 'New', sortOrder: 40, grants: wireGrants() },
      admin,
    );
    const other = await paidPlan(prisma, 'PRO');
    const product = (
      await prisma.plan.findUniqueOrThrow({
        where: { id: other.planId },
        select: { stripeProductId: true },
      })
    ).stripeProductId!;
    services.payments.prices.set('price_borrowed', {
      id: 'price_borrowed',
      active: true,
      currency: 'usd',
      unitAmount: 500,
      recurringInterval: 'month',
      productId: product,
    });
    const refused = await errorOf(
      services.plans.lookupPrice(
        {
          planId: plan!.id,
          stripePriceId: 'price_borrowed',
          billingInterval: billingGrpc.BillingInterval.BILLING_INTERVAL_MONTH,
        },
        admin,
      ),
    );
    expect(refused.details).toEqual({ issues: [{ path: '/stripePriceId', code: 'taken' }] });
  });
});
