import { status } from '@grpc/grpc-js';
import { FREE_PLAN_GRANTS, newId } from '@wayfare/contracts';
import { billingGrpc, identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway, serviceError, stubSession } from '../support/app';
import type { E2eApp } from '../support/app';

let gateway: E2eApp;
const ownerId = newId();
const planPriceId = newId();

const grants: billingGrpc.Entitlements = {
  maxPlaces: 1,
  autoNarration: false,
  narrationLanguageScope: billingGrpc.NarrationLanguageScope.NARRATION_LANGUAGE_SCOPE_BASIC,
  maxPhotosPerPlace: 3,
  maxMenuItemsPerPlace: 10,
  discoveryBoostSlots: 0,
  aiCreditsPerDay: 0,
  analyticsLevel: billingGrpc.AnalyticsLevel.ANALYTICS_LEVEL_NONE,
  canSellVouchers: false,
};

const ownerCookie = (claims: Parameters<typeof accountToken>[0] = {}) =>
  `wf_at=${accountToken({ userId: ownerId, ov: true, ev: true, perms: ['owner.access'], ...claims })}`;

function console_(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  cookie = ownerCookie(),
) {
  const agent = request(gateway.app.getHttpServer());
  return agent[method](`/api/v1${path}`).set('X-Wayfare-Client', 'console').set('Cookie', cookie);
}

const staff = (perms: string[]) => `wf_at=${accountToken({ userId: newId(), perms })}`;

/** identity answers the owner's acceptances; `current` for the owner agreement unless told otherwise. */
function acceptances(current = true): void {
  gateway.identity.users.handlers.listLegalAcceptances = () =>
    Promise.resolve({
      acceptances: [
        {
          party: identityGrpc.LegalParty.LEGAL_PARTY_USER,
          document: identityGrpc.LegalDocument.LEGAL_DOCUMENT_OWNER_AGREEMENT,
          version: '2026-09-01',
          acceptedAt: toProtoTimestamp(new Date('2026-09-18T00:00:00Z')),
          current,
        },
      ],
    });
}

beforeAll(async () => {
  gateway = await bootGateway();
});
afterAll(() => gateway.app.close());
beforeEach(() => {
  gateway.identity.reset();
  gateway.billing.reset();
  gateway.redis.values.clear();
  acceptances();
});

describe('/owner/billing', () => {
  it('reads the overview, and refuses a caller who is not an owner', async () => {
    gateway.billing.billing.handlers.getOverview = () =>
      Promise.resolve({
        plan: { id: newId(), code: 'FREE', name: 'Free' },
        price: undefined,
        subscriptionStatus: billingGrpc.SubscriptionStatus.SUBSCRIPTION_STATUS_NONE,
        currentPeriodEnd: undefined,
        cancelAtPeriodEnd: false,
        dunningSince: undefined,
        entitlements: grants,
        usagePlaces: 1,
        usageBoostsLive: 0,
        pinned: true,
        planGrants: { ...grants, maxPlaces: 0 },
      });
    const res = await console_('get', '/owner/billing');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.data).toMatchObject({
      plan: { code: 'FREE' },
      price: null,
      subscriptionStatus: 'NONE',
      dunning: null,
      entitlements: FREE_PLAN_GRANTS,
      usage: { places: 1, boostsLive: 0 },
      // A pin: the plan's own grants beside the ones in force.
      pinned: true,
      planGrants: { ...FREE_PLAN_GRANTS, maxPlaces: 0 },
    });
    const notOwner = await console_('get', '/owner/billing', ownerCookie({ ov: false }));
    expect(notOwner.status).toBe(403);
  });

  it('opens the portal, and passes NO_STRIPE_CUSTOMER through', async () => {
    gateway.billing.billing.handlers.createPortalSession = () =>
      Promise.reject(
        serviceError(status.FAILED_PRECONDITION, { 'wf-error-code': 'NO_STRIPE_CUSTOMER' }),
      );
    const res = await console_('post', '/owner/billing/portal-session');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_STRIPE_CUSTOMER');
  });
});

describe('checkout idempotency (api-endpoints-plan §0.8)', () => {
  const checkout = (key?: string, body: object = { planPriceId }) => {
    const req = console_('post', '/owner/billing/checkout-session');
    return (key === undefined ? req : req.set('Idempotency-Key', key)).send(body);
  };

  beforeEach(() => {
    let counter = 0;
    gateway.billing.billing.handlers.createCheckoutSession = () => {
      counter += 1;
      return Promise.resolve({ url: `https://checkout.stripe.test/c/${counter}` });
    };
  });

  it('requires a UUIDv7 key', async () => {
    const missing = await checkout();
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const v4 = await checkout('3b241101-e2bb-4255-8caf-4136c566a962');
    expect(v4.status).toBe(400);
    expect(v4.body.error.code).toBe('VALIDATION_FAILED');
    expect(gateway.billing.billing.calls).toHaveLength(0);
  });

  it('replays a repeat without calling billing, and forwards the key to billing', async () => {
    const key = newId();
    const first = await checkout(key);
    const again = await checkout(key);
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(gateway.billing.billing.calls).toHaveLength(1);
    expect(gateway.billing.billing.calls[0]!.request).toEqual({ planPriceId, idempotencyKey: key });
  });

  it('refuses the same key with another body, and a repeat still in flight', async () => {
    const key = newId();
    await checkout(key);
    const other = await checkout(key, { planPriceId: newId() });
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    let release: (() => void) | undefined;
    gateway.billing.billing.handlers.createCheckoutSession = () =>
      new Promise((resolve) => {
        release = () => resolve({ url: 'https://checkout.stripe.test/c/slow' });
      });
    const slowKey = newId();
    const slow = checkout(slowKey).then((res) => res);
    // Let the first request reach billing and hold its key.
    for (let attempt = 0; attempt < 50 && release === undefined; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const concurrent = await checkout(slowKey);
    expect(concurrent.status).toBe(409);
    expect(concurrent.body.error.code).toBe('IDEMPOTENCY_KEY_IN_FLIGHT');
    release!();
    expect((await slow).status).toBe(200);
  });

  it('never stores a 5xx: a retry after an outage runs again', async () => {
    const key = newId();
    gateway.billing.billing.handlers.createCheckoutSession = () =>
      Promise.reject(serviceError(status.UNAVAILABLE));
    expect((await checkout(key)).status).toBe(503);
    gateway.billing.billing.handlers.createCheckoutSession = () =>
      Promise.resolve({ url: 'https://checkout.stripe.test/c/after' });
    const retried = await checkout(key);
    expect(retried.status).toBe(200);
    expect(retried.body.data).toEqual({ url: 'https://checkout.stripe.test/c/after' });
  });

  it('stores a 4xx: SUBSCRIPTION_EXISTS replays without calling billing again', async () => {
    const key = newId();
    gateway.billing.billing.handlers.createCheckoutSession = () =>
      Promise.reject(
        serviceError(status.ALREADY_EXISTS, { 'wf-error-code': 'SUBSCRIPTION_EXISTS' }),
      );
    expect((await checkout(key)).status).toBe(409);
    const again = await checkout(key);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SUBSCRIPTION_EXISTS');
    expect(gateway.billing.billing.calls).toHaveLength(1);
  });

  it('refuses a checkout without the current owner agreement', async () => {
    acceptances(false);
    const res = await checkout(newId());
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'LEGAL_VERSION_OUTDATED',
      details: { document: 'OWNER_AGREEMENT', currentVersion: '2026-09-01' },
    });
    expect(gateway.billing.billing.calls).toHaveLength(0);
  });
});

describe('POST /api/webhooks/stripe', () => {
  it('forwards the exact bytes and the signature, and answers 204', async () => {
    gateway.billing.webhooks.handlers.receiveStripeEvent = () => Promise.resolve({});
    const raw = '{"id":"evt_1",  "type":"invoice.paid"}';
    const res = await request(gateway.app.getHttpServer())
      .post('/api/webhooks/stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1,v1=abc')
      .send(raw);
    expect(res.status).toBe(204);
    const forwarded = gateway.billing.webhooks.calls[0]!.request as {
      rawBody: Buffer;
      signature: string;
      endpoint: number;
    };
    expect(Buffer.from(forwarded.rawBody).toString('utf8')).toBe(raw);
    expect(forwarded.signature).toBe('t=1,v1=abc');
    expect(forwarded.endpoint).toBe(billingGrpc.StripeEndpoint.STRIPE_ENDPOINT_PLATFORM);
  });

  it("answers billing's refusal of a bad signature with 400", async () => {
    gateway.billing.webhooks.handlers.receiveStripeEvent = () =>
      Promise.reject(
        serviceError(status.INVALID_ARGUMENT, {
          'wf-error-code': 'VALIDATION_FAILED',
          'wf-error-details': JSON.stringify({
            issues: [{ path: '/stripe-signature', code: 'invalid_signature' }],
          }),
        }),
      );
    const res = await request(gateway.app.getHttpServer())
      .post('/api/webhooks/stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', 'forged')
      .send('{}');
    expect(res.status).toBe(400);
  });
});

describe('POST /dev/fake-stripe/checkout/:sessionId/pay', () => {
  it('asks billing to pay the fake session, and answers where Stripe would return', async () => {
    gateway.billing.webhooks.handlers.payFakeCheckout = () =>
      Promise.resolve({ successUrl: 'http://console.localhost/owner/billing?checkout=success' });
    const res = await request(gateway.app.getHttpServer())
      .post('/api/v1/dev/fake-stripe/checkout/session-1/pay')
      .set('X-Wayfare-Client', 'console');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      successUrl: 'http://console.localhost/owner/billing?checkout=success',
    });
    expect(gateway.billing.webhooks.calls.at(-1)?.request).toEqual({ sessionId: 'session-1' });
  });

  it("answers billing's refusal off the fake provider with 404", async () => {
    gateway.billing.webhooks.handlers.payFakeCheckout = () =>
      Promise.reject(
        serviceError(status.NOT_FOUND, {
          'wf-error-code': 'RESOURCE_NOT_FOUND',
          'wf-error-details': JSON.stringify({ resource: 'CHECKOUT_SESSION' }),
        }),
      );
    const res = await request(gateway.app.getHttpServer())
      .post('/api/v1/dev/fake-stripe/checkout/session-1/pay')
      .set('X-Wayfare-Client', 'console');
    expect(res.status).toBe(404);
  });
});

describe('/admin/plans and /admin/billing', () => {
  it('creates a plan and applies it as a dry run, under billing.plan.manage', async () => {
    gateway.billing.plans.handlers.createPlan = () =>
      Promise.resolve({
        plan: {
          id: newId(),
          code: 'GROWTH',
          name: 'Growth',
          isActive: true,
          sortOrder: 10,
          grants,
          prices: [],
          subscriberCount: 0,
          subscribers: { active: 0, pastDue: 0, cancelling: 0, pinned: 0 },
          createdAt: toProtoTimestamp(new Date('2026-09-18T00:00:00Z')),
          updatedAt: toProtoTimestamp(new Date('2026-09-18T00:00:00Z')),
          retiredAt: undefined,
        },
      });
    gateway.billing.plans.handlers.applyPlan = () =>
      Promise.resolve({
        dryRun: true,
        affected: 2,
        skippedPinned: 1,
        failed: 0,
        wouldEndBoosts: 0,
        accounts: [],
      });
    const manage = staff(['billing.plan.manage']);
    const created = await console_('post', '/admin/plans', manage).send({
      code: 'GROWTH',
      name: 'Growth',
      sortOrder: 10,
      grants: FREE_PLAN_GRANTS,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.plan).toMatchObject({
      code: 'GROWTH',
      stripeProductId: null,
      subscribers: { total: 0, active: 0, pastDue: 0, cancelling: 0, pinned: 0 },
      retiredAt: null,
    });
    const planId = newId();
    const dry = await console_('post', `/admin/plans/${planId}/apply?dryRun=true`, manage);
    expect(dry.status).toBe(200);
    expect(dry.body.data).toMatchObject({ dryRun: true, affected: 2, wouldUnpublishPlaces: null });
    expect(gateway.billing.plans.calls[1]!.request).toEqual({ planId, dryRun: true });
    const tooWide = await console_('post', '/admin/plans', manage).send({
      code: 'WIDE',
      name: 'Wide',
      sortOrder: 11,
      grants: { ...FREE_PLAN_GRANTS, maxPlaces: 500 },
    });
    expect(tooWide.status).toBe(400);
    expect((await console_('get', '/admin/plans', staff([]))).status).toBe(403);
    // An admin reading accounts reads the plans too, and writes none.
    const reader = staff(['billing.account.read']);
    gateway.billing.plans.handlers.listPlans = () => Promise.resolve({ plans: [] });
    expect((await console_('get', '/admin/plans', reader)).status).toBe(200);
    expect((await console_('post', '/admin/plans', reader).send({})).status).toBe(403);
  });

  it('overrides an account and lists events, under their permissions', async () => {
    const accountId = newId();
    const summary: billingGrpc.BillingAccountSummary = {
      id: accountId,
      ownerUserId: ownerId,
      planCode: 'GROWTH',
      subscriptionStatus: billingGrpc.SubscriptionStatus.SUBSCRIPTION_STATUS_ACTIVE,
      pinned: true,
      dunningSince: undefined,
      currentPeriodEnd: undefined,
      entitlementsVersion: '4',
      createdAt: toProtoTimestamp(new Date('2026-09-18T00:00:00Z')),
    };
    gateway.billing.accounts.handlers.overrideEntitlements = () =>
      Promise.resolve({
        account: {
          summary,
          cancelAtPeriodEnd: false,
          entitlements: grants,
          planGrants: grants,
          recentEvents: [],
        },
      });
    gateway.billing.events.handlers.listBillingEvents = () =>
      Promise.resolve({
        events: [
          {
            id: newId(),
            stripeEventId: 'evt_1',
            endpoint: billingGrpc.StripeEndpoint.STRIPE_ENDPOINT_PLATFORM,
            livemode: false,
            eventType: 'invoice.paid',
            stripeCreatedAt: toProtoTimestamp(new Date('2026-09-18T00:00:00Z')),
            status: billingGrpc.BillingEventStatus.BILLING_EVENT_STATUS_PROCESSED,
            receivedAt: toProtoTimestamp(new Date('2026-09-18T00:00:01Z')),
            processedAt: toProtoTimestamp(new Date('2026-09-18T00:00:02Z')),
            payloadJson: '',
            ownerUserId: ownerId,
          },
        ],
        page: { page: 1, pageSize: 20, total: 1 },
      });
    gateway.identity.adminUsers.handlers.getUserNames = () =>
      Promise.resolve({ users: [{ id: ownerId, name: 'Minh Tran', email: 'minh@example.com' }] });
    const override = await console_(
      'patch',
      `/admin/billing/accounts/${accountId}/entitlements`,
      staff(['billing.entitlement.override']),
    ).send({ grants: FREE_PLAN_GRANTS, reason: 'A negotiated deal.' });
    expect(override.status).toBe(200);
    expect(override.body.data.account).toMatchObject({
      id: accountId,
      pinned: true,
      entitlementsVersion: 4,
      owner: { name: 'Minh Tran', email: 'minh@example.com' },
      subscribedPrice: null,
      boosts: [],
      payoutAccount: null,
    });
    const events = await console_('get', '/admin/billing/events', staff(['billing.event.read']));
    expect(events.status).toBe(200);
    // The list leaves the payload out; one identity call names every owner on the page.
    expect(events.body.data[0]).toMatchObject({
      stripeEventId: 'evt_1',
      status: 'PROCESSED',
      owner: { name: 'Minh Tran', email: 'minh@example.com' },
      payload: null,
    });
    expect(gateway.identity.adminUsers.calls.map((call) => call.request)).toContainEqual({
      userIds: [ownerId],
    });
    expect(
      (await console_('get', '/admin/billing/events', staff(['billing.account.read']))).status,
    ).toBe(403);
  });
});

describe('the round-35a reads (api-endpoints-plan §6.1, §6.2)', () => {
  const manage = () => staff(['billing.plan.manage']);
  const plan = (over: Partial<billingGrpc.AdminPlan> = {}): billingGrpc.AdminPlan => ({
    id: newId(),
    code: 'GROWTH',
    name: 'Growth',
    isActive: true,
    sortOrder: 10,
    grants,
    prices: [],
    subscriberCount: 5,
    subscribers: { active: 3, pastDue: 1, cancelling: 1, pinned: 2 },
    createdAt: toProtoTimestamp(new Date('2026-09-18T00:00:00Z')),
    updatedAt: toProtoTimestamp(new Date('2026-09-19T00:00:00Z')),
    retiredAt: undefined,
    ...over,
  });

  it('lists plans with retired ones on request, and reads one', async () => {
    gateway.billing.plans.handlers.listPlans = () => Promise.resolve({ plans: [plan()] });
    const all = await console_('get', '/admin/plans?includeRetired=true', manage());
    expect(all.status).toBe(200);
    expect(all.body.data[0].subscribers).toEqual({
      total: 5,
      active: 3,
      pastDue: 1,
      cancelling: 1,
      pinned: 2,
    });
    expect(gateway.billing.plans.calls.at(-1)!.request).toEqual({ includeRetired: true });
    gateway.billing.plans.handlers.getPlan = () => Promise.resolve({ plan: plan() });
    const one = await console_('get', `/admin/plans/${newId()}`, manage());
    expect(one.status).toBe(200);
    expect(one.body.data).toMatchObject({ code: 'GROWTH', retiredAt: null });
  });

  it("looks a price up: Stripe's amount and the price it replaces, nothing written", async () => {
    const replaced: billingGrpc.PlanPrice = {
      id: newId(),
      stripePriceId: 'price_dev_growth_month',
      billingInterval: billingGrpc.BillingInterval.BILLING_INTERVAL_MONTH,
      amountMinor: 900,
      currency: 'USD',
      isActive: true,
      createdAt: toProtoTimestamp(new Date('2026-09-02T00:00:00Z')),
    };
    gateway.billing.plans.handlers.lookupPrice = () =>
      Promise.resolve({
        amountMinor: 1200,
        currency: 'USD',
        billingInterval: billingGrpc.BillingInterval.BILLING_INTERVAL_MONTH,
        productId: 'prod_dev_growth',
        replaces: replaced,
      });
    const planId = newId();
    const looked = await console_(
      'get',
      `/admin/plans/${planId}/prices/lookup?stripePriceId=price_testGrowthMonthly2&billingInterval=MONTH`,
      manage(),
    );
    expect(looked.status).toBe(200);
    expect(looked.body.data).toMatchObject({
      amount: { amountMinor: 1200, currency: 'USD' },
      interval: 'MONTH',
      productId: 'prod_dev_growth',
      replaces: { stripePriceId: 'price_dev_growth_month' },
    });
    expect(gateway.billing.plans.calls.at(-1)!.request).toEqual({
      planId,
      stripePriceId: 'price_testGrowthMonthly2',
      billingInterval: billingGrpc.BillingInterval.BILLING_INTERVAL_MONTH,
    });
    gateway.billing.plans.handlers.lookupPrice = () =>
      Promise.reject(
        serviceError(status.INVALID_ARGUMENT, {
          'wf-error-code': 'VALIDATION_FAILED',
          'wf-error-details': JSON.stringify({
            issues: [{ path: '/stripePriceId', code: 'not_found' }],
          }),
        }),
      );
    const missing = await console_(
      'get',
      `/admin/plans/${planId}/prices/lookup?stripePriceId=price_nope&billingInterval=MONTH`,
      manage(),
    );
    expect(missing.status).toBe(400);
  });

  it('previews an unpin, and reads one event with its payload and owner', async () => {
    gateway.billing.accounts.handlers.previewUnpin = () =>
      Promise.resolve({ grants, wouldUnpublishPlaces: 2 });
    const preview = await console_(
      'get',
      `/admin/billing/accounts/${newId()}/unpin-preview`,
      staff(['billing.entitlement.override']),
    );
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({ wouldUnpublishPlaces: 2 });
    expect(
      (
        await console_(
          'get',
          `/admin/billing/accounts/${newId()}/unpin-preview`,
          staff(['billing.account.read']),
        )
      ).status,
    ).toBe(403);
    gateway.billing.events.handlers.getBillingEvent = () =>
      Promise.resolve({
        event: {
          id: newId(),
          stripeEventId: 'evt_2',
          endpoint: billingGrpc.StripeEndpoint.STRIPE_ENDPOINT_PLATFORM,
          livemode: false,
          eventType: 'invoice.payment_failed',
          stripeCreatedAt: toProtoTimestamp(new Date('2026-09-18T00:00:00Z')),
          status: billingGrpc.BillingEventStatus.BILLING_EVENT_STATUS_FAILED,
          errorLog: 'no billing account for the subscription',
          receivedAt: toProtoTimestamp(new Date('2026-09-18T00:00:01Z')),
          processedAt: undefined,
          payloadJson: '{"id":"evt_2"}',
          ownerUserId: ownerId,
        },
      });
    gateway.identity.adminUsers.handlers.getUserNames = () =>
      Promise.resolve({ users: [{ id: ownerId, name: 'Minh Tran', email: 'minh@example.com' }] });
    const event = await console_(
      'get',
      `/admin/billing/events/${newId()}`,
      staff(['billing.event.read']),
    );
    expect(event.status).toBe(200);
    expect(event.body.data).toMatchObject({
      status: 'FAILED',
      payload: { id: 'evt_2' },
      owner: { name: 'Minh Tran' },
    });
  });
});

describe('/users/me for an owner (api-endpoints-plan §12.1)', () => {
  beforeEach(() => {
    const { user } = stubSession();
    gateway.identity.users.handlers.getMe = () =>
      Promise.resolve({
        user,
        roles: ['USER', 'VENUE_OWNER'],
        permissions: [],
        ownerVerified: true,
        owner: { pendingRegistration: undefined },
      });
  });

  it("composes billing's summary", async () => {
    gateway.billing.billing.handlers.getBillingSummary = () =>
      Promise.resolve({
        planCode: 'GROWTH',
        subscriptionStatus: billingGrpc.SubscriptionStatus.SUBSCRIPTION_STATUS_PAST_DUE,
        dunningSince: toProtoTimestamp(new Date('2026-09-18T08:00:00Z')),
      });
    const res = await console_('get', '/users/me');
    expect(res.status).toBe(200);
    expect(res.body.data.owner).toEqual({
      pendingRegistration: null,
      billingSummary: {
        planCode: 'GROWTH',
        subscriptionStatus: 'PAST_DUE',
        dunningSince: '2026-09-18T08:00:00.000Z',
      },
    });
    expect(res.body.meta).toBeUndefined();
  });

  it('degrades, never fails, when billing cannot answer', async () => {
    gateway.billing.billing.handlers.getBillingSummary = () =>
      Promise.reject(serviceError(status.UNAVAILABLE));
    const res = await console_('get', '/users/me');
    expect(res.status).toBe(200);
    expect(res.body.data.owner.billingSummary).toBeNull();
    expect(res.body.meta).toEqual({ degraded: ['billing'] });
  });
});
