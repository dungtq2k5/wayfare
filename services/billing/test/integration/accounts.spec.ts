// Accounts and the owner routes (api-endpoints-plan §5.1, §6.2, §12.2): one FREE account per
// verified owner, the entitlements every limit check reads, the overview read from Postgres,
// Checkout and the portal through Stripe, the cached invoices, and the zero obligations.
import {
  AUDIT_RECORD,
  AuditAction,
  BILLING_ENTITLEMENTS_CHANGED,
  FREE_PLAN_GRANTS,
  IDENTITY_OWNER_VERIFIED,
  newId,
  SubscriptionStatus,
} from '@wayfare/contracts';
import { billingGrpc } from '@wayfare/contracts/grpc';
import { buildAccountContext } from '@wayfare/nest-common/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OwnerVerifiedConsumer } from '../../src/modules/owner-verified/owner-verified.consumer';
import { outboxPayloads, testPrisma, truncateAll } from '../setup/database';
import { errorOf, owner, paidPlan } from '../setup/fixtures';
import { billingServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof billingServices>;

beforeEach(async () => {
  await truncateAll(prisma);
  services = billingServices(prisma);
});
afterAll(() => prisma.$disconnect());

describe('owner verification', () => {
  it('opens one FREE account, version 1, with its first event — twice is once', async () => {
    const consumer = new OwnerVerifiedConsumer(prisma, services.entitlements);
    const ownerUserId = newId();
    const payload = IDENTITY_OWNER_VERIFIED.schema.parse({
      eventId: newId(),
      occurredAt: new Date().toISOString(),
      userId: ownerUserId,
    });
    await consumer.handle(payload);
    await consumer.handle({ ...payload, eventId: newId() });
    const accounts = await prisma.billingAccount.findMany({ where: { ownerUserId } });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      subscriptionStatus: SubscriptionStatus.NONE,
      entitlementsVersion: 1n,
      maxPlaces: 1,
    });
    expect(await outboxPayloads(prisma, BILLING_ENTITLEMENTS_CHANGED.subject)).toEqual([
      expect.objectContaining({
        ownerUserId,
        entitlementsVersion: 1,
        entitlements: FREE_PLAN_GRANTS,
        previous: null,
      }),
    ]);
  });

  it('answers GetEntitlements, and RESOURCE_NOT_FOUND for no account', async () => {
    const account = await owner(services, prisma);
    const answer = await services.entitlements.getEntitlements(
      { ownerUserId: account.ownerUserId },
      buildAccountContext(),
    );
    expect(answer).toMatchObject({
      entitlementsVersion: '1',
      entitlements: {
        maxPlaces: 1,
        autoNarration: false,
        narrationLanguageScope: billingGrpc.NarrationLanguageScope.NARRATION_LANGUAGE_SCOPE_BASIC,
      },
    });
    expect(
      (
        await errorOf(
          services.entitlements.getEntitlements({ ownerUserId: newId() }, buildAccountContext()),
        )
      ).details,
    ).toEqual({ resource: 'BILLING_ACCOUNT' });
  });
});

describe('the owner routes', () => {
  it('reads the overview from Postgres, with catalog counting the Venues', async () => {
    const account = await owner(services, prisma);
    services.catalog.counts.set(account.ownerUserId, 2);
    const overview = await services.subscriptions.getOverview(account.context);
    expect(overview).toMatchObject({
      plan: { code: 'FREE' },
      subscriptionStatus: billingGrpc.SubscriptionStatus.SUBSCRIPTION_STATUS_NONE,
      cancelAtPeriodEnd: false,
      usagePlaces: 2,
      usageBoostsLive: 0,
      pinned: false,
    });
    expect(overview.price).toBeUndefined();
    expect(overview.dunningSince).toBeUndefined();
    services.catalog.down = true;
    expect((await services.subscriptions.getOverview(account.context)).usagePlaces).toBeUndefined();
    expect(services.payments.calls).toEqual([]);
  });

  it('lists purchasable plans: active, priced, never FREE', async () => {
    const account = await owner(services, prisma);
    await paidPlan(prisma, 'GROWTH');
    const unpriced = await paidPlan(prisma, 'PRO');
    await prisma.planPrice.update({ where: { id: unpriced.priceId }, data: { isActive: false } });
    const { plans } = await services.subscriptions.listPurchasablePlans(account.context);
    expect(plans.map((plan) => plan.code)).toEqual(['GROWTH']);
    expect(plans[0]?.prices).toHaveLength(1);
  });

  it('starts a Checkout: one customer, the key forwarded, audited; refused while subscribed', async () => {
    const account = await owner(services, prisma);
    const growth = await paidPlan(prisma, 'GROWTH');
    const key = newId();
    const { url } = await services.subscriptions.createCheckoutSession(
      { planPriceId: growth.priceId, idempotencyKey: key },
      account.context,
    );
    expect(url).toContain(key);
    await services.subscriptions.createCheckoutSession(
      { planPriceId: growth.priceId, idempotencyKey: newId() },
      account.context,
    );
    expect(services.payments.checkouts).toHaveLength(2);
    expect(services.payments.checkouts[0]).toMatchObject({
      priceId: growth.stripePriceId,
      billingAccountId: account.accountId,
      idempotencyKey: key,
    });
    expect(services.payments.checkouts[0]!.successUrl).toMatch(
      /\/owner\/billing\?checkout=success$/,
    );
    expect(services.payments.calls.filter((call) => call === 'createCustomer')).toHaveLength(1);
    const stored = await prisma.billingAccount.findUniqueOrThrow({
      where: { id: account.accountId },
    });
    expect(stored.stripeCustomerId).toMatch(/^cus_fake/);
    expect(
      (await outboxPayloads(prisma, AUDIT_RECORD.subject)).filter(
        (payload) => payload.action === AuditAction.BILLING_CHECKOUT_STARTED,
      ),
    ).toHaveLength(2);
    // No entitlement is written by a checkout.
    expect(stored.entitlementsVersion).toBe(1n);

    await prisma.billingAccount.update({
      where: { id: account.accountId },
      data: { subscriptionStatus: SubscriptionStatus.PAST_DUE },
    });
    expect(
      (
        await errorOf(
          services.subscriptions.createCheckoutSession(
            { planPriceId: growth.priceId, idempotencyKey: newId() },
            account.context,
          ),
        )
      ).code,
    ).toBe('SUBSCRIPTION_EXISTS');
  });

  it('answers 503 when Stripe cannot, and NO_STRIPE_CUSTOMER before any checkout', async () => {
    const account = await owner(services, prisma);
    const growth = await paidPlan(prisma, 'GROWTH');
    expect((await errorOf(services.subscriptions.createPortalSession(account.context))).code).toBe(
      'NO_STRIPE_CUSTOMER',
    );
    services.payments.unavailable = true;
    expect(
      (
        await errorOf(
          services.subscriptions.createCheckoutSession(
            { planPriceId: growth.priceId, idempotencyKey: newId() },
            account.context,
          ),
        )
      ).code,
    ).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('lists invoices once per five minutes from Stripe, and none without a customer', async () => {
    const account = await owner(services, prisma);
    expect(await services.subscriptions.listInvoices(account.context)).toEqual({ invoices: [] });
    await prisma.billingAccount.update({
      where: { id: account.accountId },
      data: { stripeCustomerId: 'cus_inv' },
    });
    services.payments.invoices.set('cus_inv', [
      {
        id: 'in_1',
        number: 'WF-0001',
        status: 'paid',
        total: 900,
        amountPaid: 900,
        currency: 'usd',
        created: 1_800_000_000,
        hostedInvoiceUrl: 'https://invoice.stripe.test/in_1',
        invoicePdf: null,
      },
    ]);
    const first = await services.subscriptions.listInvoices(account.context);
    const second = await services.subscriptions.listInvoices(account.context);
    expect(second).toEqual(first);
    expect(first.invoices[0]).toMatchObject({
      id: 'in_1',
      number: 'WF-0001',
      totalMinor: 900,
      currency: 'USD',
      hostedInvoiceUrl: 'https://invoice.stripe.test/in_1',
    });
    expect(services.payments.calls.filter((call) => call === 'listInvoices')).toHaveLength(1);
  });

  it("answers the owner summary, and an unknown owner's is RESOURCE_NOT_FOUND", async () => {
    const account = await owner(services, prisma);
    expect(
      await services.subscriptions.getBillingSummary({ ownerUserId: account.ownerUserId }),
    ).toEqual({
      planCode: 'FREE',
      subscriptionStatus: billingGrpc.SubscriptionStatus.SUBSCRIPTION_STATUS_NONE,
      dunningSince: undefined,
    });
    expect(
      (await errorOf(services.subscriptions.getBillingSummary({ ownerUserId: newId() }))).code,
    ).toBe('RESOURCE_NOT_FOUND');
  });
});

describe('admin accounts and seller obligations', () => {
  it('lists accounts by plan and pin, and shows the detail with plan grants', async () => {
    const first = await owner(services, prisma);
    await owner(services, prisma);
    await prisma.billingAccount.update({
      where: { id: first.accountId },
      data: { entitlementsPinned: true },
    });
    const admin = buildAccountContext();
    const pinned = await services.accounts.listAccounts(
      { page: { page: 1, pageSize: 20, sort: '' }, status: 0, pinned: true },
      admin,
    );
    expect(pinned.accounts.map((row) => row.id)).toEqual([first.accountId]);
    const all = await services.accounts.listAccounts(
      { page: { page: 1, pageSize: 20, sort: '' }, status: 0, planCode: 'FREE' },
      admin,
    );
    expect(all.page).toEqual({ page: 1, pageSize: 20, total: 2 });
    const { account } = await services.accounts.getAccount(
      { billingAccountId: first.accountId },
      admin,
    );
    expect(account).toMatchObject({
      summary: { planCode: 'FREE', pinned: true },
      planGrants: { maxPlaces: 1 },
      recentEvents: [],
    });
  });

  it('answers zero obligations until vouchers exist', async () => {
    expect(await services.seller.getLiveObligations({ ownerUserId: newId() })).toEqual({
      issuedVoucherCount: 0,
      openCheckoutCount: 0,
    });
    expect(await services.seller.countLiveVouchers({ placeId: newId() })).toEqual({ count: 0 });
  });
});
