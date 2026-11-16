import type { Entitlements } from '@wayfare/contracts';
import { analyticsLevelProto, narrationLanguageScopeProto } from '@wayfare/contracts/grpc';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import type { Prisma } from '../../../generated/prisma/client';

/** The grant columns of a plan (rdm-spec B-1). */
export const PLAN_GRANTS_SELECT = {
  maxPlaces: true,
  autoNarration: true,
  narrationLanguageScope: true,
  maxPhotosPerPlace: true,
  maxMenuItemsPerPlace: true,
  discoveryBoostSlots: true,
  aiCreditsPerDay: true,
  analyticsLevel: true,
  canSellVouchers: true,
  voucherCommissionBps: true,
} as const satisfies Prisma.PlanSelect;

/** A plan row with its grants, code and name. */
export const PLAN_WITH_GRANTS_SELECT = {
  id: true,
  code: true,
  name: true,
  ...PLAN_GRANTS_SELECT,
} as const satisfies Prisma.PlanSelect;

/** A plan as `PLAN_WITH_GRANTS_SELECT` loads it. */
export type PlanWithGrantsRow = Prisma.PlanGetPayload<{ select: typeof PLAN_WITH_GRANTS_SELECT }>;

/** An account as every write reads it (rdm-spec B-3). */
export const BILLING_ACCOUNT_SELECT = {
  id: true,
  ownerUserId: true,
  stripeCustomerId: true,
  planId: true,
  planPriceId: true,
  stripeSubscriptionId: true,
  subscriptionStatus: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
  lastStripeEventAt: true,
  lastInvoiceEventAt: true,
  dunningStartedAt: true,
  entitlementsPinned: true,
  entitlementsVersion: true,
  createdAt: true,
  ...PLAN_GRANTS_SELECT,
  plan: { select: { id: true, code: true, name: true } },
} as const satisfies Prisma.BillingAccountSelect;

/** An account as `BILLING_ACCOUNT_SELECT` loads it. */
export type BillingAccountRow = Prisma.BillingAccountGetPayload<{
  select: typeof BILLING_ACCOUNT_SELECT;
}>;

/** A grant set on the wire. */
export function toEntitlements(grants: Entitlements): billingGrpc.Entitlements {
  return {
    maxPlaces: grants.maxPlaces,
    autoNarration: grants.autoNarration,
    narrationLanguageScope: narrationLanguageScopeProto.toProto(grants.narrationLanguageScope),
    maxPhotosPerPlace: grants.maxPhotosPerPlace,
    maxMenuItemsPerPlace: grants.maxMenuItemsPerPlace,
    discoveryBoostSlots: grants.discoveryBoostSlots,
    aiCreditsPerDay: grants.aiCreditsPerDay,
    analyticsLevel: analyticsLevelProto.toProto(grants.analyticsLevel),
    canSellVouchers: grants.canSellVouchers,
    ...(grants.voucherCommissionBps === null
      ? {}
      : { voucherCommissionBps: grants.voucherCommissionBps }),
  };
}

/**
 * A grant set from a request, before validation: an unknown enum reads as null, which the caller's
 * schema refuses. An absent commission arrives as null or undefined from the proto loader.
 */
export function fromProtoEntitlements(grants: billingGrpc.Entitlements): {
  [K in keyof Entitlements]: Entitlements[K] | null;
} {
  return {
    maxPlaces: grants.maxPlaces,
    autoNarration: grants.autoNarration,
    narrationLanguageScope: narrationLanguageScopeProto.fromProto(grants.narrationLanguageScope),
    maxPhotosPerPlace: grants.maxPhotosPerPlace,
    maxMenuItemsPerPlace: grants.maxMenuItemsPerPlace,
    discoveryBoostSlots: grants.discoveryBoostSlots,
    aiCreditsPerDay: grants.aiCreditsPerDay,
    analyticsLevel: analyticsLevelProto.fromProto(grants.analyticsLevel),
    canSellVouchers: grants.canSellVouchers,
    voucherCommissionBps: grants.voucherCommissionBps ?? null,
  };
}
