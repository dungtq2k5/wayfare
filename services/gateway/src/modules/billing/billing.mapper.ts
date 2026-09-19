import { CurrencyCode } from '@wayfare/contracts';
import type {
  BillingOverview,
  BillingSummary,
  Entitlements,
  Invoice,
  Plan,
  PlanPrice,
} from '@wayfare/contracts';
import {
  analyticsLevelProto,
  billingIntervalProto,
  narrationLanguageScopeProto,
  subscriptionStatusProto,
} from '@wayfare/contracts/grpc';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import { fromOptionalProtoTimestamp, fromProtoTimestamp } from '@wayfare/nest-common';

/** An enum this build cannot read is a server fault, never a client's. */
function known<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`billing sent an unknown ${what}`);
  return value;
}

/** A grant set; an absent optional becomes `null` (conventions §6.3). */
export function toEntitlements(grants: billingGrpc.Entitlements | undefined): Entitlements {
  if (grants === undefined) throw new Error('billing sent no grants');
  return {
    maxPlaces: grants.maxPlaces,
    autoNarration: grants.autoNarration,
    narrationLanguageScope: known(
      narrationLanguageScopeProto.fromProto(grants.narrationLanguageScope),
      'narration scope',
    ),
    maxPhotosPerPlace: grants.maxPhotosPerPlace,
    maxMenuItemsPerPlace: grants.maxMenuItemsPerPlace,
    discoveryBoostSlots: grants.discoveryBoostSlots,
    aiCreditsPerDay: grants.aiCreditsPerDay,
    analyticsLevel: known(analyticsLevelProto.fromProto(grants.analyticsLevel), 'analytics level'),
    canSellVouchers: grants.canSellVouchers,
    voucherCommissionBps: grants.voucherCommissionBps ?? null,
  };
}

/** A registered price, its amount as money. */
export function toPlanPrice(price: billingGrpc.PlanPrice): PlanPrice {
  return {
    id: price.id,
    stripePriceId: price.stripePriceId,
    billingInterval: known(billingIntervalProto.fromProto(price.billingInterval), 'interval'),
    amount: { amountMinor: price.amountMinor, currency: CurrencyCode.USD },
    isActive: price.isActive,
  };
}

/** A purchasable plan. */
export function toPlan(plan: billingGrpc.Plan): Plan {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    grants: toEntitlements(plan.grants),
    prices: plan.prices.map(toPlanPrice),
  };
}

/** `GET /owner/billing`. */
export function toBillingOverview(overview: billingGrpc.GetOverviewResponse): BillingOverview {
  if (overview.plan === undefined) throw new Error('billing sent an overview without its plan');
  const dunning = fromOptionalProtoTimestamp(overview.dunningSince, 'dunningSince');
  return {
    plan: { id: overview.plan.id, code: overview.plan.code, name: overview.plan.name },
    price:
      overview.price === undefined || overview.price === null ? null : toPlanPrice(overview.price),
    subscriptionStatus: known(
      subscriptionStatusProto.fromProto(overview.subscriptionStatus),
      'subscription status',
    ),
    currentPeriodEnd:
      fromOptionalProtoTimestamp(overview.currentPeriodEnd, 'currentPeriodEnd')?.toISOString() ??
      null,
    cancelAtPeriodEnd: overview.cancelAtPeriodEnd,
    dunning: dunning === null ? null : { since: dunning.toISOString() },
    entitlements: toEntitlements(overview.entitlements),
    usage: { places: overview.usagePlaces ?? null, boostsLive: overview.usageBoostsLive },
    pinned: overview.pinned,
  };
}

/** One invoice, its amounts as money. */
export function toInvoice(invoice: billingGrpc.Invoice): Invoice {
  const currency = CurrencyCode.USD;
  return {
    id: invoice.id,
    number: invoice.number ?? null,
    status: invoice.status,
    total: { amountMinor: invoice.totalMinor, currency },
    amountPaid: { amountMinor: invoice.amountPaidMinor, currency },
    createdAt: fromProtoTimestamp(invoice.createdAt, 'createdAt').toISOString(),
    hostedInvoiceUrl: invoice.hostedInvoiceUrl ?? null,
    invoicePdfUrl: invoice.invoicePdfUrl ?? null,
  };
}

/** `/users/me`'s `owner.billingSummary`. */
export function toBillingSummary(summary: billingGrpc.GetBillingSummaryResponse): BillingSummary {
  return {
    planCode: summary.planCode,
    subscriptionStatus: known(
      subscriptionStatusProto.fromProto(summary.subscriptionStatus),
      'subscription status',
    ),
    dunningSince:
      fromOptionalProtoTimestamp(summary.dunningSince, 'dunningSince')?.toISOString() ?? null,
  };
}
