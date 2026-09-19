import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  BILLING_SUBSCRIPTION_PAYMENT_FAILED,
  BillingEventStatus,
  NOTIFICATION_CREATE,
  NotificationType,
  parseEnum,
  StripeEndpoint,
  SubscriptionStatus,
  subscribedPlanApplies,
  UUID_V7_PATTERN,
} from '@wayfare/contracts';
import { stripeEndpointProto } from '@wayfare/contracts/grpc';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import { isUniqueConstraintViolation, OutboxService, rpcError } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';
import type { Env } from '../../config/env.schema';
import { PaymentsProvider } from '../../providers/payments/payments-provider';
import {
  StripeWebhookVerifier,
  WebhookSignatureError,
} from '../../providers/payments/stripe-webhook.verifier';
import { billingAuditRecord, NO_ORIGIN } from '../entitlements/domain/billing-audit';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  accountKeys,
  checkoutFacts,
  eventRoute,
  invoiceFacts,
  staleness,
  stripeInstant,
  subscriptionFacts,
} from './domain/subscription-event';
import type { AccountKeys, SubscriptionFacts } from './domain/subscription-event';
import { WebhookQueue } from '../webhook-queue/webhook-queue.module';
import type { WebhookItem } from '../webhook-queue/webhook-queue.module';

/** Attempts before an event is `FAILED` (api-endpoints-plan §6.3). */
export const WEBHOOK_MAX_ATTEMPTS = 3;

/** The wait before attempt 2 and attempt 3. */
export const WEBHOOK_RETRY_DELAYS_MS: readonly number[] = [10_000, 60_000];

const STRIPE: { readonly type: AuditActorType.STRIPE } = { type: AuditActorType.STRIPE };

/** A processing error worth a retry: its message is what `error_log` keeps. */
class WebhookProcessingError extends Error {}

/** What one attempt settled on. */
type Outcome =
  BillingEventStatus.PROCESSED | BillingEventStatus.SKIPPED_STALE | BillingEventStatus.IGNORED;

/** An event row as processing reads it. */
interface EventRow {
  readonly id: string;
  readonly eventType: string;
  readonly livemode: boolean;
  readonly stripeCreatedAt: Date;
  readonly billingAccountId: string | null;
  readonly payload: Prisma.JsonValue;
  readonly status: string;
}

/**
 * Stripe's platform webhook (api-endpoints-plan §6.3, rdm-spec §1.12, B-4): verify over the exact
 * bytes, record, acknowledge, then process on the queue — never inline. Every processing outcome
 * stamps `processed_at`; an error is retried, and after the third attempt the row is `FAILED`,
 * `processed_at` still NULL, until an admin replays it.
 */
@Injectable()
export class WebhooksService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly liveMode: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly verifier: StripeWebhookVerifier,
    private readonly payments: PaymentsProvider,
    private readonly entitlements: EntitlementsService,
    private readonly queue: WebhookQueue,
    config: ConfigService<Env, true>,
  ) {
    // The mode comes from the key's side of the configuration (architecture §5).
    this.liveMode = config.get('STRIPE_MODE', { infer: true }) === 'live';
  }

  onApplicationBootstrap(): void {
    this.queue.start(async (item) => {
      await this.process(item.data);
    });
  }

  /**
   * Verifies, records `RECEIVED` and queues the first attempt. A bad signature is `400` and stores
   * nothing; a duplicate `stripe_event_id` is acknowledged and changes nothing.
   */
  async receiveStripeEvent(
    request: billingGrpc.ReceiveStripeEventRequest,
  ): Promise<billingGrpc.ReceiveStripeEventResponse> {
    const endpoint = stripeEndpointProto.fromProto(request.endpoint) ?? StripeEndpoint.PLATFORM;
    if (endpoint !== StripeEndpoint.PLATFORM) {
      // The Connect endpoint arrives with Phase 3, and its own secret.
      throw rpcError('VALIDATION_FAILED', { issues: [{ path: '/endpoint', code: 'unsupported' }] });
    }
    let event;
    try {
      event = this.verifier.verify(Buffer.from(request.rawBody), request.signature);
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        this.logger.warn('Stripe webhook refused: bad signature');
        throw rpcError('VALIDATION_FAILED', {
          issues: [{ path: '/stripe-signature', code: 'invalid_signature' }],
        });
      }
      throw error;
    }
    const object = (event.raw.data as { object?: unknown } | undefined)?.object;
    const billingAccountId = await this.resolveAccountId(this.prisma, accountKeys(object));
    let id: string;
    try {
      const row = await this.prisma.billingEvent.create({
        data: {
          stripeEventId: event.id,
          endpoint,
          livemode: event.livemode,
          eventType: event.type,
          stripeCreatedAt: stripeInstant(event.created),
          billingAccountId,
          payload: event.raw as Prisma.InputJsonValue,
          status: BillingEventStatus.RECEIVED,
        },
        select: { id: true },
      });
      id = row.id;
    } catch (error) {
      // The unique event id is the idempotency (rdm-spec §1.12): a redelivery is acknowledged.
      if (isUniqueConstraintViolation(error)) return {};
      throw error;
    }
    await this.enqueue({ billingEventId: id, attempt: 1 });
    return {};
  }

  /** Adds an attempt; a queue that cannot take it is left to the recovery sweep. */
  async enqueue(item: WebhookItem, delayMs?: number): Promise<void> {
    await this.queue.add(item, delayMs).catch((error: unknown) =>
      this.logger.warn(
        {
          billingEventId: item.billingEventId,
          err: error instanceof Error ? error.name : 'unknown',
        },
        'webhook item not queued; recovery will add it',
      ),
    );
  }

  /** One attempt at one event. Only a `RECEIVED` row is processed. */
  async process(item: WebhookItem): Promise<BillingEventStatus | null> {
    const event = await this.prisma.billingEvent.findUnique({
      where: { id: item.billingEventId },
      select: {
        id: true,
        eventType: true,
        livemode: true,
        stripeCreatedAt: true,
        billingAccountId: true,
        payload: true,
        status: true,
      },
    });
    if (event === null || event.status !== String(BillingEventStatus.RECEIVED)) return null;
    try {
      return await this.handle(event);
    } catch (error) {
      return this.failed(event, item, error);
    }
  }

  private async handle(event: EventRow): Promise<Outcome> {
    const route = eventRoute(event.eventType);
    // `livemode` must match the key's mode (architecture §5): a test event on a live deployment, or the reverse.
    if (route === 'IGNORED' || event.livemode !== this.liveMode) {
      return this.settle(this.prisma, event.id, BillingEventStatus.IGNORED);
    }
    const object = (event.payload as { data?: { object?: unknown } } | null)?.data?.object;
    switch (route) {
      case 'CHECKOUT':
        return this.checkoutCompleted(event, object);
      case 'SUBSCRIPTION':
        return this.subscriptionChanged(event, subscriptionFacts(object));
      case 'INVOICE_PAID':
      case 'INVOICE_FAILED':
        return this.invoiceEvent(event, route === 'INVOICE_FAILED', object);
    }
  }

  /** `checkout.session.completed` in subscription mode links the customer and subscription. */
  private async checkoutCompleted(event: EventRow, object: unknown): Promise<Outcome> {
    const facts = checkoutFacts(object);
    if (!facts.subscriptionMode) {
      // A payment-mode session is a voucher order: Phase 3.
      return this.settle(this.prisma, event.id, BillingEventStatus.IGNORED);
    }
    const accountId =
      facts.clientReferenceId !== null && UUID_V7_PATTERN.test(facts.clientReferenceId)
        ? facts.clientReferenceId
        : null;
    return this.prisma.$transaction(async (tx) => {
      const account =
        accountId === null ? null : await this.entitlements.lockAccount(tx, { id: accountId });
      if (account === null) throw new WebhookProcessingError('no billing account for the session');
      await tx.billingAccount.update({
        where: { id: account.id },
        data: {
          ...(account.stripeCustomerId === null && facts.customerId !== null
            ? { stripeCustomerId: facts.customerId }
            : {}),
          ...(account.stripeSubscriptionId === null && facts.subscriptionId !== null
            ? { stripeSubscriptionId: facts.subscriptionId }
            : {}),
        },
        select: { id: true },
      });
      return this.settle(tx, event.id, BillingEventStatus.PROCESSED, account.id);
    });
  }

  /**
   * `customer.subscription.*` under the monotonic guard (rdm-spec §1.12): an older event skips, the
   * same second re-reads the subscription from Stripe and applies what it says now (api-endpoints-plan §6.3), a newer
   * one applies its own object. Then the effective plan, the grants unless pinned, the audit rows,
   * and `SUBSCRIPTION_ACTIVATED` when a paid plan starts to apply.
   */
  private async subscriptionChanged(event: EventRow, own: SubscriptionFacts): Promise<Outcome> {
    const keys: AccountKeys = {
      customerId: own.customerId,
      subscriptionId: own.subscriptionId,
      clientReferenceId: null,
    };
    const accountId = event.billingAccountId ?? (await this.resolveAccountId(this.prisma, keys));
    if (accountId === null)
      throw new WebhookProcessingError('no billing account for the subscription');
    // The tie's re-read happens before the transaction: no Stripe call while a row is locked.
    const guard = await this.prisma.billingAccount.findUnique({
      where: { id: accountId },
      select: { lastStripeEventAt: true },
    });
    const reread =
      guard !== null && staleness(event.stripeCreatedAt, guard.lastStripeEventAt) === 'TIE'
        ? subscriptionFacts(await this.payments.retrieveSubscription(own.subscriptionId))
        : null;
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const account = await this.entitlements.lockAccount(tx, { id: accountId });
      if (account === null)
        throw new WebhookProcessingError('no billing account for the subscription');
      const timing = staleness(event.stripeCreatedAt, account.lastStripeEventAt);
      if (timing === 'STALE') {
        return this.settle(tx, event.id, BillingEventStatus.SKIPPED_STALE, account.id);
      }
      if (timing === 'TIE' && reread === null) {
        // Another event of this second landed meanwhile: the next attempt re-reads.
        throw new WebhookProcessingError('a same-second event arrived meanwhile');
      }
      const facts = timing === 'TIE' ? reread! : own;
      const price = await tx.planPrice.findUnique({
        where: { stripePriceId: facts.priceId },
        select: { id: true, planId: true, plan: { select: { code: true } } },
      });
      if (price === null) throw new WebhookProcessingError(`no plan price for ${facts.priceId}`);
      const before = parseEnum(SubscriptionStatus, account.subscriptionStatus);
      await tx.billingAccount.update({
        where: { id: account.id },
        data: {
          subscriptionStatus: facts.status,
          planPriceId: price.id,
          stripeSubscriptionId: facts.subscriptionId,
          ...(account.stripeCustomerId === null ? { stripeCustomerId: facts.customerId } : {}),
          currentPeriodStart: facts.currentPeriodStart,
          currentPeriodEnd: facts.currentPeriodEnd,
          cancelAtPeriodEnd: facts.cancelAtPeriodEnd,
          lastStripeEventAt: event.stripeCreatedAt,
        },
        select: { id: true },
      });
      const updated = await this.entitlements.lockAccount(tx, { id: account.id });
      await this.entitlements.rederive(tx, updated!, now, STRIPE);
      const after = await tx.billingAccount.findUniqueOrThrow({
        where: { id: account.id },
        select: { plan: { select: { code: true } } },
      });
      await this.audit(tx, AuditAction.BILLING_SUBSCRIPTION_CHANGED, account.id, now, {
        before: { subscriptionStatus: before, planCode: account.plan.code },
        after: { subscriptionStatus: facts.status, planCode: after.plan.code },
      });
      if (!subscribedPlanApplies(before) && subscribedPlanApplies(facts.status)) {
        await this.outbox.add(tx, NOTIFICATION_CREATE, {
          occurredAt: now.toISOString(),
          recipientUserId: account.ownerUserId,
          notification: {
            type: NotificationType.SUBSCRIPTION_ACTIVATED,
            data: { planCode: price.plan.code },
          },
        });
      }
      return this.settle(tx, event.id, BillingEventStatus.PROCESSED, account.id);
    });
  }

  /**
   * `invoice.paid` / `invoice.payment_failed` under their own guard (rdm-spec B-3): an event older than
   * `last_invoice_event_at` changes nothing. A failure starts dunning once per streak and tells the
   * owner every time; a payment ends it.
   */
  private async invoiceEvent(event: EventRow, failed: boolean, object: unknown): Promise<Outcome> {
    const facts = invoiceFacts(object);
    const accountId =
      event.billingAccountId ??
      (await this.resolveAccountId(this.prisma, {
        customerId: facts.customerId,
        subscriptionId: facts.subscriptionId,
        clientReferenceId: null,
      }));
    if (accountId === null) throw new WebhookProcessingError('no billing account for the invoice');
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const account = await this.entitlements.lockAccount(tx, { id: accountId });
      if (account === null) throw new WebhookProcessingError('no billing account for the invoice');
      if (staleness(event.stripeCreatedAt, account.lastInvoiceEventAt) === 'STALE') {
        return this.settle(tx, event.id, BillingEventStatus.SKIPPED_STALE, account.id);
      }
      await tx.billingAccount.update({
        where: { id: account.id },
        data: {
          lastInvoiceEventAt: event.stripeCreatedAt,
          dunningStartedAt: failed ? (account.dunningStartedAt ?? event.stripeCreatedAt) : null,
        },
        select: { id: true },
      });
      if (failed) {
        await this.outbox.add(tx, BILLING_SUBSCRIPTION_PAYMENT_FAILED, {
          occurredAt: now.toISOString(),
          ownerUserId: account.ownerUserId,
          attemptCount: facts.attemptCount,
          ...(facts.nextAttemptAt === null
            ? {}
            : { nextAttemptAt: facts.nextAttemptAt.toISOString() }),
        });
      }
      return this.settle(tx, event.id, BillingEventStatus.PROCESSED, account.id);
    });
  }

  /** An attempt failed: retry with backoff, or after the last attempt mark `FAILED` and audit it. */
  private async failed(
    event: EventRow,
    item: WebhookItem,
    error: unknown,
  ): Promise<BillingEventStatus | null> {
    const errorLog = describe(error);
    this.logger.warn(
      { billingEventId: event.id, eventType: event.eventType, attempt: item.attempt, errorLog },
      'Stripe event processing failed',
    );
    if (item.attempt < WEBHOOK_MAX_ATTEMPTS) {
      await this.prisma.billingEvent.update({
        where: { id: event.id },
        data: { errorLog },
        select: { id: true },
      });
      await this.enqueue(
        { billingEventId: event.id, attempt: item.attempt + 1 },
        WEBHOOK_RETRY_DELAYS_MS[item.attempt - 1],
      );
      return null;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.billingEvent.update({
        where: { id: event.id },
        data: { status: BillingEventStatus.FAILED, errorLog },
        select: { id: true },
      });
      await this.outbox.add(
        tx,
        AUDIT_RECORD,
        billingAuditRecord({
          actor: { type: AuditActorType.SYSTEM },
          action: AuditAction.BILLING_WEBHOOK_FAILED,
          resource: { type: AuditResourceType.BILLING_EVENT, id: event.id },
          metadata: { after: { eventType: event.eventType } },
          origin: NO_ORIGIN,
          now: new Date(),
        }),
      );
    });
    return BillingEventStatus.FAILED;
  }

  /** Sets an outcome and `processed_at`, and the account the event was resolved to. */
  private async settle(
    db: Prisma.TransactionClient,
    billingEventId: string,
    status: Outcome,
    billingAccountId?: string,
  ): Promise<Outcome> {
    await db.billingEvent.update({
      where: { id: billingEventId },
      data: {
        status,
        processedAt: new Date(),
        errorLog: null,
        ...(billingAccountId === undefined ? {} : { billingAccountId }),
      },
      select: { id: true },
    });
    return status;
  }

  /** The account an event names: by `client_reference_id`, subscription or customer. */
  private async resolveAccountId(
    db: Prisma.TransactionClient,
    keys: AccountKeys,
  ): Promise<string | null> {
    const or: Prisma.BillingAccountWhereInput[] = [];
    if (keys.clientReferenceId !== null && UUID_V7_PATTERN.test(keys.clientReferenceId)) {
      or.push({ id: keys.clientReferenceId });
    }
    if (keys.subscriptionId !== null) or.push({ stripeSubscriptionId: keys.subscriptionId });
    if (keys.customerId !== null) or.push({ stripeCustomerId: keys.customerId });
    if (or.length === 0) return null;
    const account = await db.billingAccount.findFirst({ where: { OR: or }, select: { id: true } });
    return account?.id ?? null;
  }

  private async audit(
    tx: Prisma.TransactionClient,
    action: AuditAction,
    billingAccountId: string,
    now: Date,
    metadata: { before?: Record<string, unknown>; after?: Record<string, unknown> },
  ): Promise<void> {
    await this.outbox.add(
      tx,
      AUDIT_RECORD,
      billingAuditRecord({
        actor: STRIPE,
        action,
        resource: { type: AuditResourceType.BILLING_ACCOUNT, id: billingAccountId },
        metadata,
        origin: NO_ORIGIN,
        now,
      }),
    );
  }
}

/** What `error_log` keeps: the error's class and message — never a card or an email, which no path puts there. */
function describe(error: unknown): string {
  if (error instanceof WebhookProcessingError) return error.message;
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 1000);
  return 'unknown error';
}
