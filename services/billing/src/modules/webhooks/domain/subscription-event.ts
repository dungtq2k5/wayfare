import { SubscriptionStatus } from '@wayfare/contracts';
import { z } from 'zod';

/** How processing treats an event type (api-endpoints-plan §6.3, cut to R1). */
export type EventRoute =
  'CHECKOUT' | 'SUBSCRIPTION' | 'INVOICE_PAID' | 'INVOICE_FAILED' | 'IGNORED';

const SUBSCRIPTION_TYPES: ReadonlySet<string> = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

/** The route of an event type; every type this build does not handle is `IGNORED`. */
export function eventRoute(type: string): EventRoute {
  if (type === 'checkout.session.completed') return 'CHECKOUT';
  if (SUBSCRIPTION_TYPES.has(type)) return 'SUBSCRIPTION';
  if (type === 'invoice.paid') return 'INVOICE_PAID';
  if (type === 'invoice.payment_failed') return 'INVOICE_FAILED';
  return 'IGNORED';
}

/** An event's timing against a guard (rdm-spec §1.12): whole seconds, so a tie is common. */
export type Staleness = 'NEWER' | 'TIE' | 'STALE';

/** Older than the guard is stale; the same second is a tie (re-read the subscription); else newer. */
export function staleness(created: Date, guard: Date | null): Staleness {
  if (guard === null) return 'NEWER';
  if (created.getTime() < guard.getTime()) return 'STALE';
  return created.getTime() === guard.getTime() ? 'TIE' : 'NEWER';
}

/** Stripe's `created` seconds as an instant. */
export function stripeInstant(seconds: number): Date {
  return new Date(seconds * 1000);
}

/** An id, or an expanded object with one. */
const zRef = z
  .union([z.string(), z.object({ id: z.string() })])
  .transform((value) => (typeof value === 'string' ? value : value.id));

const zSeconds = z.number().int().nullish();

const STRIPE_STATUS: Readonly<Record<string, SubscriptionStatus>> = {
  incomplete: SubscriptionStatus.INCOMPLETE,
  incomplete_expired: SubscriptionStatus.INCOMPLETE_EXPIRED,
  trialing: SubscriptionStatus.TRIALING,
  active: SubscriptionStatus.ACTIVE,
  past_due: SubscriptionStatus.PAST_DUE,
  unpaid: SubscriptionStatus.UNPAID,
  canceled: SubscriptionStatus.CANCELED,
  paused: SubscriptionStatus.PAUSED,
};

const zItem = z.object({
  price: z.object({ id: z.string() }),
  current_period_start: zSeconds,
  current_period_end: zSeconds,
});

const zSubscription = z.object({
  id: z.string(),
  customer: zRef,
  status: z.string().refine((status) => status in STRIPE_STATUS, 'Unknown subscription status'),
  cancel_at_period_end: z.boolean().default(false),
  // Before API version 2025-03-31 the period sat on the subscription; now on each item.
  current_period_start: zSeconds,
  current_period_end: zSeconds,
  items: z.object({ data: z.array(zItem).min(1) }),
});

/** The columns a subscription object writes (rdm-spec B-3). */
export interface SubscriptionFacts {
  readonly subscriptionId: string;
  readonly customerId: string;
  readonly status: SubscriptionStatus;
  readonly priceId: string;
  readonly currentPeriodStart: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
}

/** Reads a Stripe subscription object — an event's, or one re-read on a tie. Throws on another shape. */
export function subscriptionFacts(object: unknown): SubscriptionFacts {
  const subscription = zSubscription.parse(object);
  const item = subscription.items.data[0]!;
  const start = item.current_period_start ?? subscription.current_period_start ?? null;
  const end = item.current_period_end ?? subscription.current_period_end ?? null;
  return {
    subscriptionId: subscription.id,
    customerId: subscription.customer,
    status: STRIPE_STATUS[subscription.status]!,
    priceId: item.price.id,
    currentPeriodStart: start === null ? null : stripeInstant(start),
    currentPeriodEnd: end === null ? null : stripeInstant(end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };
}

const zCheckout = z.object({
  mode: z.string(),
  client_reference_id: z.string().nullish(),
  customer: zRef.nullish(),
  subscription: zRef.nullish(),
});

/** What a completed Checkout Session links (api-endpoints-plan §6.3). */
export interface CheckoutFacts {
  readonly subscriptionMode: boolean;
  readonly clientReferenceId: string | null;
  readonly customerId: string | null;
  readonly subscriptionId: string | null;
}

export function checkoutFacts(object: unknown): CheckoutFacts {
  const session = zCheckout.parse(object);
  return {
    subscriptionMode: session.mode === 'subscription',
    clientReferenceId: session.client_reference_id ?? null,
    customerId: session.customer ?? null,
    subscriptionId: session.subscription ?? null,
  };
}

const zInvoice = z.object({
  customer: zRef.nullish(),
  attempt_count: z.number().int().min(0).default(0),
  next_payment_attempt: zSeconds,
  subscription: zRef.nullish(),
  parent: z
    .object({
      subscription_details: z.object({ subscription: zRef.nullish() }).nullish(),
    })
    .nullish(),
});

/** What an invoice event says about dunning. */
export interface InvoiceFacts {
  readonly customerId: string | null;
  readonly subscriptionId: string | null;
  readonly attemptCount: number;
  readonly nextAttemptAt: Date | null;
}

export function invoiceFacts(object: unknown): InvoiceFacts {
  const invoice = zInvoice.parse(object);
  const next = invoice.next_payment_attempt ?? null;
  return {
    customerId: invoice.customer ?? null,
    subscriptionId:
      invoice.parent?.subscription_details?.subscription ?? invoice.subscription ?? null,
    // A failure is at least its first attempt.
    attemptCount: Math.max(invoice.attempt_count, 1),
    nextAttemptAt: next === null ? null : stripeInstant(next),
  };
}

/** The keys an event names its account by, whatever its type: read once, at receipt. */
export interface AccountKeys {
  readonly customerId: string | null;
  readonly subscriptionId: string | null;
  readonly clientReferenceId: string | null;
}

const zAnyObject = z.object({
  object: z.string().optional(),
  id: z.string().optional(),
  customer: zRef.nullish(),
  subscription: zRef.nullish(),
  client_reference_id: z.string().nullish(),
});

/** Best effort: an object this build cannot read names no account, and processing decides. */
export function accountKeys(object: unknown): AccountKeys {
  const parsed = zAnyObject.safeParse(object);
  if (!parsed.success) return { customerId: null, subscriptionId: null, clientReferenceId: null };
  const value = parsed.data;
  return {
    customerId: value.customer ?? null,
    subscriptionId:
      value.object === 'subscription' ? (value.id ?? null) : (value.subscription ?? null),
    clientReferenceId: value.client_reference_id ?? null,
  };
}
