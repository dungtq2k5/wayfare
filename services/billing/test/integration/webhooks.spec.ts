// Stripe's platform webhook (api-endpoints-plan §6.3, rdm-spec §1.12, B-3, B-4): the real SDK
// verifies, the unique event id deduplicates, the monotonic guards order, a tie re-reads, the mode
// must match, and failures retry into FAILED and replay.
import {
  AUDIT_RECORD,
  AuditAction,
  BILLING_ENTITLEMENTS_CHANGED,
  BILLING_SUBSCRIPTION_PAYMENT_FAILED,
  BillingEventStatus,
  EntitlementsChangeCause,
  FREE_PLAN_GRANTS,
  newId,
  NOTIFICATION_CREATE,
  NotificationType,
  SubscriptionStatus,
  IgnoredReason,
} from '@wayfare/contracts';
import { billingGrpc } from '@wayfare/contracts/grpc';
import { buildAccountContext } from '@wayfare/nest-common/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FAKE_FAILURE_MARKER,
  WEBHOOK_MAX_ATTEMPTS,
} from '../../src/modules/webhooks/webhooks.service';
import { outboxPayloads, testPrisma, truncateAll } from '../setup/database';
import {
  checkoutSession,
  deliver,
  drain,
  errorOf,
  GROWTH_GRANTS,
  invoice,
  owner,
  paidPlan,
  PRO_GRANTS,
  receive,
  stripeEvent,
  subscription,
} from '../setup/fixtures';
import { billingServices, stripeSignature } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof billingServices>;
let growth: Awaited<ReturnType<typeof paidPlan>>;
let pro: Awaited<ReturnType<typeof paidPlan>>;
let account: Awaited<ReturnType<typeof owner>>;
const CUSTOMER = 'cus_walk';
const SUB = 'sub_walk';
const T0 = Math.floor(Date.now() / 1000) - 3_600;

beforeEach(async () => {
  await truncateAll(prisma);
  services = billingServices(prisma);
  growth = await paidPlan(prisma, 'GROWTH');
  pro = await paidPlan(prisma, 'PRO');
  account = await owner(services, prisma);
});
afterAll(() => prisma.$disconnect());

const stateOf = () =>
  prisma.billingAccount.findUniqueOrThrow({
    where: { id: account.accountId },
    select: {
      subscriptionStatus: true,
      planId: true,
      planPriceId: true,
      maxPlaces: true,
      autoNarration: true,
      entitlementsVersion: true,
      entitlementsPinned: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      dunningStartedAt: true,
      lastStripeEventAt: true,
    },
  });

const eventRow = (stripeEventId: string) =>
  prisma.billingEvent.findUniqueOrThrow({ where: { stripeEventId } });

const subscriptionEvent = (
  type: string,
  status: string,
  created: number,
  price = growth.stripePriceId,
) => stripeEvent(type, subscription({ id: SUB, customer: CUSTOMER, price, status }), { created });

async function linked(): Promise<void> {
  await deliver(
    services,
    stripeEvent(
      'checkout.session.completed',
      checkoutSession({ accountId: account.accountId, customer: CUSTOMER, subscription: SUB }),
      { created: T0 },
    ),
  );
}

async function subscribed(created = T0 + 10): Promise<void> {
  await linked();
  await deliver(services, subscriptionEvent('customer.subscription.created', 'active', created));
}

describe('receiving', () => {
  it('refuses a bad signature with 400 and stores nothing — the SDK verifies', async () => {
    const body = JSON.stringify(stripeEvent('invoice.paid', {}));
    const refused = await errorOf(
      services.webhooks.receiveStripeEvent({
        rawBody: Buffer.from(body),
        signature: stripeSignature(body, 'whsec_someone_else'),
        endpoint: 1,
      }),
    );
    expect(refused.code).toBe('VALIDATION_FAILED');
    const tampered = await errorOf(
      services.webhooks.receiveStripeEvent({
        rawBody: Buffer.from(body.replace('invoice.paid', 'invoice.void')),
        signature: stripeSignature(body),
        endpoint: 1,
      }),
    );
    expect(tampered.code).toBe('VALIDATION_FAILED');
    expect(await prisma.billingEvent.count()).toBe(0);
  });

  it('records a duplicate evt_ once and queues it once', async () => {
    const event = stripeEvent('charge.refunded', { id: 'ch_1' });
    await receive(services, event);
    await receive(services, event);
    expect(await prisma.billingEvent.count()).toBe(1);
    expect(services.queue.items).toHaveLength(1);
    expect((await eventRow(event.id as string)).status).toBe(BillingEventStatus.RECEIVED);
  });

  it('ignores an unhandled type and an event in the other mode, saying which', async () => {
    const refund = stripeEvent('charge.refunded', { id: 'ch_1' });
    const live = subscriptionEvent('customer.subscription.created', 'active', T0 + 5);
    (live as { livemode: boolean }).livemode = true;
    await deliver(services, refund);
    await deliver(services, live);
    for (const [event, reason] of [
      [refund, IgnoredReason.UNHANDLED_TYPE],
      [live, IgnoredReason.LIVEMODE_MISMATCH],
    ] as const) {
      const row = await eventRow(event.id as string);
      expect(row.status).toBe(BillingEventStatus.IGNORED);
      expect(row.processedAt).not.toBeNull();
      expect(row.errorLog).toBe(reason);
    }
    expect((await stateOf()).subscriptionStatus).toBe(SubscriptionStatus.NONE);
  });
});

describe('subscriptions', () => {
  it('links the checkout, then applies Growth: version 2, the event, the notification', async () => {
    await subscribed();
    const state = await stateOf();
    expect(state).toMatchObject({
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      planId: growth.planId,
      planPriceId: growth.priceId,
      stripeCustomerId: CUSTOMER,
      stripeSubscriptionId: SUB,
      maxPlaces: 10,
      autoNarration: true,
      entitlementsVersion: 2n,
    });
    const changes = await outboxPayloads(prisma, BILLING_ENTITLEMENTS_CHANGED.subject);
    expect(changes.at(-1)).toMatchObject({
      ownerUserId: account.ownerUserId,
      entitlementsVersion: 2,
      entitlements: GROWTH_GRANTS,
      previous: FREE_PLAN_GRANTS,
    });
    const notes = await outboxPayloads(prisma, NOTIFICATION_CREATE.subject);
    expect(notes).toEqual([
      expect.objectContaining({
        recipientUserId: account.ownerUserId,
        notification: {
          type: NotificationType.SUBSCRIPTION_ACTIVATED,
          data: { planCode: 'GROWTH' },
        },
      }),
    ]);
    const actions = (await outboxPayloads(prisma, AUDIT_RECORD.subject)).map(
      (payload) => payload.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        AuditAction.BILLING_SUBSCRIPTION_CHANGED,
        AuditAction.BILLING_ENTITLEMENTS_APPLIED,
      ]),
    );
  });

  it('skips an older event after a newer one, leaving the grants', async () => {
    await subscribed(T0 + 20);
    const late = subscriptionEvent('customer.subscription.updated', 'canceled', T0 + 15);
    await deliver(services, late);
    expect((await eventRow(late.id as string)).status).toBe(BillingEventStatus.SKIPPED_STALE);
    expect(await stateOf()).toMatchObject({
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      maxPlaces: 10,
    });
  });

  it('re-reads the subscription on a same-second tie and applies what Stripe says now', async () => {
    await linked();
    // Checkout sends .created (incomplete) and .updated (active) in the same second.
    await deliver(
      services,
      subscriptionEvent('customer.subscription.created', 'incomplete', T0 + 30),
    );
    expect((await stateOf()).subscriptionStatus).toBe(SubscriptionStatus.INCOMPLETE);
    services.payments.subscriptions.set(
      SUB,
      subscription({ id: SUB, customer: CUSTOMER, price: growth.stripePriceId, status: 'active' }),
    );
    // The tie's own object is stale on purpose: Stripe's current state must win.
    const tie = subscriptionEvent('customer.subscription.updated', 'incomplete', T0 + 30);
    await deliver(services, tie);
    expect(services.payments.calls).toContain('retrieveSubscription');
    expect((await eventRow(tie.id as string)).status).toBe(BillingEventStatus.PROCESSED);
    expect(await stateOf()).toMatchObject({
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      autoNarration: true,
    });
  });

  it('falls back to Free on deletion: plan_id FREE, the price kept, grants narrowed', async () => {
    await subscribed();
    await deliver(
      services,
      subscriptionEvent('customer.subscription.deleted', 'canceled', T0 + 40),
    );
    const free = await prisma.plan.findFirstOrThrow({ where: { code: 'FREE' } });
    expect(await stateOf()).toMatchObject({
      subscriptionStatus: SubscriptionStatus.CANCELED,
      planId: free.id,
      planPriceId: growth.priceId,
      maxPlaces: 1,
      autoNarration: false,
      entitlementsVersion: 3n,
    });
    // A new subscription brings Growth back, with a new SUBSCRIPTION_ACTIVATED.
    await deliver(services, subscriptionEvent('customer.subscription.created', 'active', T0 + 50));
    expect((await stateOf()).maxPlaces).toBe(10);
    expect(await outboxPayloads(prisma, NOTIFICATION_CREATE.subject)).toHaveLength(2);
  });

  it('sends nothing on a move between paid plans', async () => {
    await subscribed();
    await deliver(
      services,
      subscriptionEvent('customer.subscription.updated', 'active', T0 + 60, pro.stripePriceId),
    );
    expect(await stateOf()).toMatchObject({ planId: pro.planId, maxPlaces: PRO_GRANTS.maxPlaces });
    expect(await outboxPayloads(prisma, NOTIFICATION_CREATE.subject)).toHaveLength(1);
  });
});

describe('failures', () => {
  it('retries an unknown price three times, then FAILED and replayable', async () => {
    await linked();
    const unknown = subscriptionEvent(
      'customer.subscription.created',
      'active',
      T0 + 70,
      'price_unknown',
    );
    await receive(services, unknown);
    const delays: (number | undefined)[] = [];
    for (let attempt = 1; attempt <= WEBHOOK_MAX_ATTEMPTS; attempt++) {
      const [queued] = services.queue.items.splice(0);
      expect(queued?.item.attempt).toBe(attempt);
      delays.push(queued?.delayMs);
      await services.webhooks.process(queued!.item);
    }
    expect(delays[0]).toBeUndefined();
    expect(delays.slice(1).every((delay) => (delay ?? 0) > 0)).toBe(true);
    const failed = await eventRow(unknown.id as string);
    expect(failed).toMatchObject({ status: BillingEventStatus.FAILED, processedAt: null });
    expect(failed.errorLog).toContain('price_unknown');
    expect(services.queue.items).toHaveLength(0);
    expect(
      (await outboxPayloads(prisma, AUDIT_RECORD.subject)).filter(
        (payload) => payload.action === AuditAction.BILLING_WEBHOOK_FAILED,
      ),
    ).toHaveLength(1);

    // Registered afterwards, the price makes the replay succeed.
    await prisma.planPrice.update({
      where: { id: growth.priceId },
      data: { stripePriceId: 'price_unknown' },
    });
    const admin = buildAccountContext();
    const { event } = await services.events.replayBillingEvent(
      { billingEventId: failed.id },
      admin,
    );
    expect(event?.status).toBe(billingGrpc.BillingEventStatus.BILLING_EVENT_STATUS_RECEIVED);
    await drain(services);
    expect((await eventRow(unknown.id as string)).status).toBe(BillingEventStatus.PROCESSED);
    expect((await stateOf()).subscriptionStatus).toBe(SubscriptionStatus.ACTIVE);
  });

  it('fails an event whose account cannot be resolved, and refuses to replay a processed one', async () => {
    const orphan = stripeEvent(
      'customer.subscription.created',
      subscription({
        id: 'sub_x',
        customer: 'cus_x',
        price: growth.stripePriceId,
        status: 'active',
      }),
    );
    await receive(services, orphan);
    for (let attempt = 1; attempt <= WEBHOOK_MAX_ATTEMPTS; attempt++) {
      await services.webhooks.process(services.queue.take()[0]!);
    }
    const row = await eventRow(orphan.id as string);
    expect(row.status).toBe(BillingEventStatus.FAILED);
    expect(row.errorLog).toContain('no billing account');
    await subscribed();
    const processed = await prisma.billingEvent.findFirstOrThrow({
      where: { status: BillingEventStatus.PROCESSED },
    });
    const refused = await errorOf(
      services.events.replayBillingEvent({ billingEventId: processed.id }, buildAccountContext()),
    );
    expect(refused.code).toBe('INVALID_STATE');
  });
});

describe('the round-35a reads', () => {
  it('keeps the subscribed price after a cancellation; events carry their owner', async () => {
    await subscribed();
    const admin = buildAccountContext();
    const read = async () =>
      (await services.accounts.getAccount({ billingAccountId: account.accountId }, admin)).account;
    expect((await read())?.subscribedPrice).toEqual({
      amountMinor: 900,
      currency: 'USD',
      billingInterval: billingGrpc.BillingInterval.BILLING_INTERVAL_MONTH,
    });
    await deliver(
      services,
      subscriptionEvent('customer.subscription.deleted', 'canceled', T0 + 400),
    );
    const cancelled = await read();
    expect(cancelled?.summary?.planCode).toBe('FREE');
    expect(cancelled?.subscribedPrice?.amountMinor).toBe(900);
    expect(cancelled?.recentEvents[0]).toMatchObject({
      ownerUserId: account.ownerUserId,
      payloadJson: '',
    });

    const { events } = await services.events.listBillingEvents(
      { page: { page: 1, pageSize: 20, sort: '' }, status: 0 },
      admin,
    );
    expect(events.every((event) => event.payloadJson === '')).toBe(true);
    expect(events.every((event) => event.ownerUserId === account.ownerUserId)).toBe(true);
    const { event } = await services.events.getBillingEvent(
      { billingEventId: events[0]!.id },
      admin,
    );
    expect(JSON.parse(event!.payloadJson)).toMatchObject({ object: 'event' });
    expect(
      (await errorOf(services.events.getBillingEvent({ billingEventId: newId() }, admin))).code,
    ).toBe('RESOURCE_NOT_FOUND');
  });

  it('has no subscribed price for an account that never subscribed', async () => {
    const { account: never } = await services.accounts.getAccount(
      { billingAccountId: account.accountId },
      buildAccountContext(),
    );
    expect(never?.subscribedPrice).toBeUndefined();
  });

  it('fails an event carrying the fake failure marker on every try, until replayed', async () => {
    await linked();
    const marked = stripeEvent(
      'customer.subscription.updated',
      {
        ...subscription({
          id: SUB,
          customer: CUSTOMER,
          price: growth.stripePriceId,
          status: 'active',
        }),
        metadata: { [FAKE_FAILURE_MARKER]: '1' },
      },
      { created: T0 + 50 },
    );
    await deliver(services, marked);
    const row = await eventRow(marked.id as string);
    expect(row.status).toBe(BillingEventStatus.FAILED);
    expect(row.errorLog).toContain('fake failure marker');
  });
});

describe('dunning', () => {
  it('starts on a failed payment, keeps the grants while past due, and ends on payment', async () => {
    await subscribed();
    await deliver(
      services,
      stripeEvent(
        'invoice.payment_failed',
        invoice({
          customer: CUSTOMER,
          subscription: SUB,
          attemptCount: 2,
          nextAttempt: T0 + 86_400,
        }),
        { created: T0 + 100 },
      ),
    );
    await deliver(
      services,
      subscriptionEvent('customer.subscription.updated', 'past_due', T0 + 101),
    );
    const dunning = await stateOf();
    expect(dunning.dunningStartedAt).not.toBeNull();
    expect(dunning).toMatchObject({
      subscriptionStatus: SubscriptionStatus.PAST_DUE,
      maxPlaces: 10,
    });
    expect(await outboxPayloads(prisma, BILLING_SUBSCRIPTION_PAYMENT_FAILED.subject)).toEqual([
      expect.objectContaining({
        ownerUserId: account.ownerUserId,
        attemptCount: 2,
        nextAttemptAt: new Date((T0 + 86_400) * 1000).toISOString(),
      }),
    ]);

    await deliver(
      services,
      stripeEvent('invoice.paid', invoice({ customer: CUSTOMER, subscription: SUB }), {
        created: T0 + 200,
      }),
    );
    expect((await stateOf()).dunningStartedAt).toBeNull();

    // A payment_failed older than the paid that settled it changes nothing.
    const late = stripeEvent(
      'invoice.payment_failed',
      invoice({ customer: CUSTOMER, subscription: SUB }),
      { created: T0 + 150 },
    );
    await deliver(services, late);
    expect((await eventRow(late.id as string)).status).toBe(BillingEventStatus.SKIPPED_STALE);
    expect((await stateOf()).dunningStartedAt).toBeNull();
    expect(await outboxPayloads(prisma, BILLING_SUBSCRIPTION_PAYMENT_FAILED.subject)).toHaveLength(
      1,
    );
  });
});

describe('pins', () => {
  it('keeps an override through a subscription event; unpinning re-derives', async () => {
    await subscribed();
    const admin = buildAccountContext();
    const grants = { ...GROWTH_GRANTS, maxPlaces: 25 };
    const { account: overridden } = await services.accounts.overrideEntitlements(
      {
        billingAccountId: account.accountId,
        grants: {
          ...grants,
          narrationLanguageScope: 2,
          analyticsLevel: 2,
          voucherCommissionBps: 1500,
        },
        reason: 'A negotiated deal for a market stall cooperative.',
      },
      admin,
    );
    expect(overridden?.summary?.pinned).toBe(true);
    expect((await stateOf()).maxPlaces).toBe(25);

    await deliver(
      services,
      subscriptionEvent('customer.subscription.updated', 'past_due', T0 + 300),
    );
    expect(await stateOf()).toMatchObject({
      subscriptionStatus: SubscriptionStatus.PAST_DUE,
      maxPlaces: 25,
      entitlementsPinned: true,
    });

    await services.accounts.unpinEntitlements(
      { billingAccountId: account.accountId, reason: 'Deal ended.' },
      admin,
    );
    expect(await stateOf()).toMatchObject({ entitlementsPinned: false, maxPlaces: 10 });
    const audits = (await outboxPayloads(prisma, AUDIT_RECORD.subject)).filter((payload) =>
      [AuditAction.ENTITLEMENTS_OVERRIDDEN, AuditAction.ENTITLEMENTS_UNPINNED].includes(
        payload.action as AuditAction,
      ),
    );
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      metadata: { reason: 'A negotiated deal for a market stall cooperative.' },
    });
    // Each publish says why: the purchase, the override, then the unpin.
    const causes = (await outboxPayloads(prisma, BILLING_ENTITLEMENTS_CHANGED.subject)).map(
      (payload) => payload.cause,
    );
    expect(causes.slice(-3)).toEqual([
      EntitlementsChangeCause.SUBSCRIPTION,
      EntitlementsChangeCause.OVERRIDE,
      EntitlementsChangeCause.UNPIN,
    ]);
  });

  it("previews an unpin: today's grants and the Places they'd take off, nothing written", async () => {
    await subscribed();
    const admin = buildAccountContext();
    await services.accounts.overrideEntitlements(
      {
        billingAccountId: account.accountId,
        grants: {
          ...GROWTH_GRANTS,
          maxPlaces: 15,
          narrationLanguageScope: 2,
          analyticsLevel: 2,
          voucherCommissionBps: 1500,
        },
        reason: 'A pilot partner.',
      },
      admin,
    );
    services.catalog.counts.set(account.ownerUserId, 12);
    const preview = await services.accounts.previewUnpin(
      { billingAccountId: account.accountId },
      admin,
    );
    expect(preview).toMatchObject({ grants: { maxPlaces: 10 }, wouldUnpublishPlaces: 2 });
    expect(await stateOf()).toMatchObject({ entitlementsPinned: true, maxPlaces: 15 });
    services.catalog.down = true;
    expect(
      (await services.accounts.previewUnpin({ billingAccountId: account.accountId }, admin))
        .wouldUnpublishPlaces,
    ).toBeUndefined();
  });

  it('refuses an override above a ceiling', async () => {
    const refused = await errorOf(
      services.accounts.overrideEntitlements(
        {
          billingAccountId: account.accountId,
          grants: {
            ...GROWTH_GRANTS,
            maxPlaces: 101,
            narrationLanguageScope: 2,
            analyticsLevel: 2,
            voucherCommissionBps: 1500,
          },
          reason: 'Too much.',
        },
        buildAccountContext(),
      ),
    );
    expect(refused.code).toBe('VALIDATION_FAILED');
  });
});
