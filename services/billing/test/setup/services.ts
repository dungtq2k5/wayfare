// The billing use cases wired by hand over the test database — the same graph Nest builds, with
// the fake payments provider, an in-memory webhook queue and a catalog that counts from a map.
import { OutboxService } from '@wayfare/nest-common';
import Stripe from 'stripe';
import type { PrismaService } from '../../src/modules/prisma/prisma.service';
import { AccountsService } from '../../src/modules/accounts/accounts.service';
import { BillingEventsService } from '../../src/modules/billing-events/billing-events.service';
import type { CatalogServiceGrpcClient } from '../../src/modules/catalog/catalog-service-grpc.client';
import { EntitlementsService } from '../../src/modules/entitlements/entitlements.service';
import { PlansService } from '../../src/modules/plans/plans.service';
import { SellerService } from '../../src/modules/seller/seller.service';
import { UserErasedConsumer } from '../../src/modules/user-erased/user-erased.consumer';
import { SubscriptionsService } from '../../src/modules/subscriptions/subscriptions.service';
import type {
  WebhookItem,
  WebhookQueue,
} from '../../src/modules/webhook-queue/webhook-queue.module';
import { WebhooksService } from '../../src/modules/webhooks/webhooks.service';
import { FakePaymentsProvider } from '../../src/providers/payments/fake.payments-provider';
import { StripeWebhookVerifier } from '../../src/providers/payments/stripe-webhook.verifier';
import { testConfig } from './database';

/** The queue, remembering what was added; nothing runs until a spec drains it. */
export class RecordingQueue {
  readonly items: { item: WebhookItem; delayMs: number | undefined }[] = [];
  readonly runsWorker = false;

  add(item: WebhookItem, delayMs?: number): Promise<void> {
    this.items.push({ item, delayMs });
    return Promise.resolve();
  }

  has(billingEventId: string): Promise<boolean> {
    return Promise.resolve(this.items.some(({ item }) => item.billingEventId === billingEventId));
  }

  start(): void {}

  /** The items added so far, emptying the list. */
  take(): WebhookItem[] {
    return this.items.splice(0).map(({ item }) => item);
  }
}

/** Counts per owner; `null` answers as catalog down. */
export class FakeCatalog {
  readonly counts = new Map<string, number>();
  down = false;

  countOwnerPlaces(ownerUserId: string): Promise<number | null> {
    return Promise.resolve(this.down ? null : (this.counts.get(ownerUserId) ?? 0));
  }
}

/** An in-memory Redis for the invoice cache. */
export class MemoryRedis {
  readonly values = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string): Promise<'OK'> {
    this.values.set(key, value);
    return Promise.resolve('OK');
  }
}

/** Every billing use case over one Prisma client. */
export function billingServices(prisma: PrismaService, options: { mode?: 'test' | 'live' } = {}) {
  const config = testConfig(
    options.mode === 'live'
      ? { STRIPE_MODE: 'live', STRIPE_SECRET_KEY: 'rk_live_integration' }
      : {},
  );
  const outbox = new OutboxService();
  const payments = new FakePaymentsProvider();
  const queue = new RecordingQueue();
  const catalog = new FakeCatalog();
  const redis = new MemoryRedis();
  const verifier = new StripeWebhookVerifier(config);
  const entitlements = new EntitlementsService(prisma, outbox);
  const catalogClient = catalog as unknown as CatalogServiceGrpcClient;
  const webhooks = new WebhooksService(
    prisma,
    outbox,
    verifier,
    payments,
    entitlements,
    queue as unknown as WebhookQueue,
    config,
  );
  return {
    config,
    outbox,
    payments,
    queue,
    catalog,
    redis,
    entitlements,
    webhooks,
    subscriptions: new SubscriptionsService(prisma, outbox, payments, catalogClient, redis, config),
    plans: new PlansService(prisma, outbox, payments, entitlements, catalogClient),
    accounts: new AccountsService(prisma, outbox, entitlements),
    events: new BillingEventsService(prisma, outbox, webhooks),
    seller: new SellerService(prisma),
    userErased: new UserErasedConsumer(prisma, payments),
  };
}

/** The webhook secret setup/env.ts configures. */
export const TEST_WEBHOOK_SECRET = 'whsec_test_integration';

/** A `Stripe-Signature` header for a payload, from the SDK's own test helper. */
export function stripeSignature(
  payload: string,
  secret: string = TEST_WEBHOOK_SECRET,
  at: Date = new Date(),
): string {
  return Stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
    timestamp: Math.floor(at.getTime() / 1000),
  });
}
