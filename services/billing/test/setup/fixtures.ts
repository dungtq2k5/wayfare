// Plans, accounts and signed Stripe events for the billing suites.
import { AnalyticsLevel, NarrationLanguageScope, newId } from '@wayfare/contracts';
import type { Entitlements } from '@wayfare/contracts';
import { buildAccountContext } from '@wayfare/nest-common/testing';
import type { AccountContext } from '@wayfare/nest-common';
import { grantColumns } from '../../src/modules/entitlements/domain/grants-write';
import type { PrismaService } from '../../src/modules/prisma/prisma.service';
import type { billingServices } from './services';
import { stripeSignature } from './services';

type Services = ReturnType<typeof billingServices>;

/** Product §8.2's Growth column. */
export const GROWTH_GRANTS: Entitlements = {
  maxPlaces: 10,
  autoNarration: true,
  narrationLanguageScope: NarrationLanguageScope.LAUNCH,
  maxPhotosPerPlace: 8,
  maxMenuItemsPerPlace: 200,
  discoveryBoostSlots: 1,
  aiCreditsPerDay: 10,
  analyticsLevel: AnalyticsLevel.BASIC,
  canSellVouchers: true,
  voucherCommissionBps: 1500,
};

/** Product §8.2's Pro column. */
export const PRO_GRANTS: Entitlements = {
  ...GROWTH_GRANTS,
  maxPlaces: 50,
  narrationLanguageScope: NarrationLanguageScope.EXTENDED,
  discoveryBoostSlots: 5,
  analyticsLevel: AnalyticsLevel.FULL,
  voucherCommissionBps: 1000,
};

/** A paid plan with an active monthly price, by SQL-free Prisma writes. */
export async function paidPlan(
  prisma: PrismaService,
  code: 'GROWTH' | 'PRO',
): Promise<{ planId: string; priceId: string; stripePriceId: string }> {
  const grants = code === 'GROWTH' ? GROWTH_GRANTS : PRO_GRANTS;
  const stripePriceId = `price_${code.toLowerCase()}${newId().replaceAll('-', '').slice(-8)}`;
  const plan = await prisma.plan.create({
    data: {
      code,
      name: code === 'GROWTH' ? 'Growth' : 'Pro',
      sortOrder: code === 'GROWTH' ? 10 : 20,
      stripeProductId: `prod_${code.toLowerCase()}${newId().replaceAll('-', '').slice(-8)}`,
      ...grantColumns(grants),
      prices: {
        create: {
          stripePriceId,
          billingInterval: 'MONTH',
          amountMinor: code === 'GROWTH' ? 900 : 2900,
        },
      },
    },
    select: { id: true, prices: { select: { id: true } } },
  });
  return { planId: plan.id, priceId: plan.prices[0]!.id, stripePriceId };
}

/** An owner with a FREE account, and a context acting as them. */
export async function owner(
  services: Services,
  prisma: PrismaService,
): Promise<{ ownerUserId: string; accountId: string; context: AccountContext }> {
  const ownerUserId = newId();
  await prisma.$transaction((tx) =>
    services.entitlements.openFreeAccount(tx, ownerUserId, new Date()),
  );
  const account = await prisma.billingAccount.findUniqueOrThrow({
    where: { ownerUserId },
    select: { id: true },
  });
  return {
    ownerUserId,
    accountId: account.id,
    context: buildAccountContext({ userId: ownerUserId, ownerVerified: true }),
  };
}

/** A Stripe event's envelope around an object. */
export function stripeEvent(
  type: string,
  object: Record<string, unknown>,
  options: { created?: number; livemode?: boolean; id?: string } = {},
): Record<string, unknown> {
  return {
    id: options.id ?? `evt_${newId().replaceAll('-', '')}`,
    object: 'event',
    api_version: '2026-08-26.dahlia',
    type,
    created: options.created ?? Math.floor(Date.now() / 1000),
    livemode: options.livemode ?? false,
    data: { object },
  };
}

/** A subscription object at one price and status. */
export function subscription(fields: {
  id: string;
  customer: string;
  price: string;
  status: string;
  cancelAtPeriodEnd?: boolean;
}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: fields.id,
    object: 'subscription',
    customer: fields.customer,
    status: fields.status,
    cancel_at_period_end: fields.cancelAtPeriodEnd ?? false,
    items: {
      object: 'list',
      data: [
        {
          price: { id: fields.price },
          current_period_start: now,
          current_period_end: now + 30 * 86_400,
        },
      ],
    },
  };
}

/** A completed subscription-mode Checkout Session for an account. */
export function checkoutSession(fields: {
  accountId: string;
  customer: string;
  subscription: string;
}): Record<string, unknown> {
  return {
    id: `cs_${newId().replaceAll('-', '')}`,
    object: 'checkout.session',
    mode: 'subscription',
    client_reference_id: fields.accountId,
    customer: fields.customer,
    subscription: fields.subscription,
  };
}

/** An invoice of a customer's subscription. */
export function invoice(fields: {
  customer: string;
  subscription: string;
  attemptCount?: number;
  nextAttempt?: number | null;
}): Record<string, unknown> {
  return {
    id: `in_${newId().replaceAll('-', '')}`,
    object: 'invoice',
    customer: fields.customer,
    attempt_count: fields.attemptCount ?? 1,
    next_payment_attempt: fields.nextAttempt ?? null,
    parent: { subscription_details: { subscription: fields.subscription } },
  };
}

/** Posts a signed event to billing, as the gateway forwards it. */
export function receive(services: Services, event: Record<string, unknown>): Promise<unknown> {
  const body = JSON.stringify(event);
  return services.webhooks.receiveStripeEvent({
    rawBody: Buffer.from(body),
    signature: stripeSignature(body),
    endpoint: 1,
  });
}

/** Receives an event and runs every queued attempt, retries included, until none is left. */
export async function deliver(services: Services, event: Record<string, unknown>) {
  await receive(services, event);
  return drain(services);
}

/** Runs the queued attempts, as the worker would, ignoring their delays. */
export async function drain(services: Services): Promise<void> {
  for (let guard = 0; guard < 10; guard++) {
    const items = services.queue.take();
    if (items.length === 0) return;
    for (const item of items) await services.webhooks.process(item);
  }
}

/** A failed call's code and details. */
export async function errorOf(
  promise: Promise<unknown>,
): Promise<{ code: string; details: unknown }> {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to fail');
    },
    (e: unknown) => e,
  );
  const rpc = error as { getError?: () => { metadata: { get(key: string): unknown[] } } };
  if (typeof rpc.getError !== 'function') throw error;
  const metadata = rpc.getError().metadata;
  const details = metadata.get('wf-error-details')[0];
  return {
    code: String(metadata.get('wf-error-code')[0]),
    details: typeof details === 'string' ? (JSON.parse(details) as unknown) : undefined,
  };
}
