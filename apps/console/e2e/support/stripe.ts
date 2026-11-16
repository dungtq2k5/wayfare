// Stripe's webhooks as the stack receives them (K15): events signed with billing's local secret,
// posted to the gateway's webhook route. The stack's fake Stripe holds no subscription, so each
// account's events are a second apart: a same-second one would re-read it from Stripe.
import { createHmac } from 'node:crypto';
import type { Actor } from './stack';
import { GATEWAY, envValue } from './stack';

/** The marker that makes an event fail on every try, in development builds (K15). */
export const FAKE_FAILURE = 'wayfare_fake_failure';

/** One event as Stripe sends it. */
export interface StripeEvent {
  readonly id: string;
  readonly type: string;
  /** Stripe's `created`, in seconds. */
  readonly created: number;
  readonly livemode?: boolean;
  readonly object: Record<string, unknown>;
}

const secret = () =>
  process.env.STRIPE_WEBHOOK_SECRET ?? envValue('billing', 'STRIPE_WEBHOOK_SECRET');

/** Signs and posts one event, as Stripe would; the gateway answers 204. */
export async function sendStripeEvent(event: StripeEvent): Promise<void> {
  const payload = JSON.stringify({
    id: event.id,
    object: 'event',
    type: event.type,
    created: event.created,
    livemode: event.livemode ?? false,
    api_version: '2025-09-30.clover',
    data: { object: event.object },
  });
  // A 503 or 504 is asked again, as Stripe would: billing records an event id once, so a resend of
  // one it did record changes nothing.
  for (let attempt = 0; ; attempt++) {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', secret())
      .update(`${timestamp}.${payload}`)
      .digest('hex');
    const response = await fetch(`${GATEWAY}/api/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': `t=${timestamp},v1=${signature}`,
      },
      body: payload,
    });
    if (response.status === 204) return;
    if (![503, 504].includes(response.status) || attempt >= 4)
      throw new Error(`the webhook route answered ${response.status}: ${await response.text()}`);
    await new Promise((done) => setTimeout(done, 3_000));
  }
}

/** Stripe's seconds for now, `offset` seconds away. */
export const seconds = (offset = 0): number => Math.floor(Date.now() / 1000) + offset;

/** A subscription object (`customer.subscription.*`), on one price. */
export function subscription(fields: {
  id: string;
  customer: string;
  status: string;
  price: string;
  periodEnd: number;
  cancelAtPeriodEnd?: boolean;
  metadata?: Record<string, string>;
}): Record<string, unknown> {
  return {
    id: fields.id,
    object: 'subscription',
    customer: fields.customer,
    status: fields.status,
    cancel_at_period_end: fields.cancelAtPeriodEnd ?? false,
    metadata: fields.metadata ?? {},
    items: {
      object: 'list',
      data: [
        {
          price: { id: fields.price },
          current_period_start: fields.periodEnd - 30 * 86_400,
          current_period_end: fields.periodEnd,
        },
      ],
    },
  };
}

/** A completed Checkout Session in subscription mode, naming the account it was opened for. */
export const checkout = (accountId: string, customer: string, subscriptionId: string) => ({
  id: `cs_test_${subscriptionId}`,
  object: 'checkout.session',
  mode: 'subscription',
  client_reference_id: accountId,
  customer,
  subscription: subscriptionId,
  customer_details: { email: `${customer}@example.com` },
});

/** A failed invoice: dunning starts, Stripe's next try on `nextAttempt`. */
export const failedInvoice = (customer: string, subscriptionId: string, nextAttempt: number) => ({
  id: `in_${subscriptionId}`,
  object: 'invoice',
  customer,
  subscription: subscriptionId,
  attempt_count: 1,
  next_payment_attempt: nextAttempt,
});

interface EventRow {
  id: string;
  stripeEventId: string;
  status: string;
}

/**
 * Waits until billing has settled an event — in a status other than `RECEIVED`, or in one of
 * `statuses` — and returns its row. A failing event takes its three tries, about 70 s.
 */
export async function untilEvent(
  admin: Actor,
  stripeEventId: string,
  statuses: readonly string[] = [],
  timeoutMs = 120_000,
): Promise<EventRow> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { data } = await admin.call<{ data: EventRow[] }>(
      'GET',
      '/admin/billing/events?pageSize=100',
    );
    const row = data.find((event) => event.stripeEventId === stripeEventId);
    if (
      row !== undefined &&
      (statuses.length === 0 ? row.status !== 'RECEIVED' : statuses.includes(row.status))
    )
      return row;
    if (Date.now() > deadline)
      throw new Error(`${stripeEventId} is ${row?.status ?? 'not recorded'} after ${timeoutMs} ms`);
    await new Promise((done) => setTimeout(done, 2_000));
  }
}

/** A billing account by its owner's email. */
export async function accountOf(admin: Actor, email: string): Promise<{ id: string }> {
  for (let page = 1; ; page++) {
    const { data, meta } = await admin.call<{
      data: { id: string; owner: { email: string | null } }[];
      meta: { total: number };
    }>('GET', `/admin/billing/accounts?pageSize=100&page=${page}`);
    const row = data.find((account) => account.owner.email === email);
    if (row !== undefined) return row;
    if (page * 100 >= meta.total) throw new Error(`no billing account for ${email}`);
  }
}
