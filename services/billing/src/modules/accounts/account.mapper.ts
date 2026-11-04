import { BillingInterval, CurrencyCode, parseEnum, SubscriptionStatus } from '@wayfare/contracts';
import type { Entitlements } from '@wayfare/contracts';
import { billingIntervalProto, subscriptionStatusProto } from '@wayfare/contracts/grpc';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import { toBillingEvent } from '../billing-events/billing-event.mapper';
import type { BillingEventRow } from '../billing-events/billing-event.mapper';
import { grantsOf } from '../entitlements/domain/grants-write';
import { toEntitlements } from '../entitlements/entitlement.mapper';
import type { BillingAccountRow } from '../entitlements/entitlement.mapper';

/** An account as the admin list shows it (api-endpoints-plan §6.2). */
export function toBillingAccountSummary(row: BillingAccountRow): billingGrpc.BillingAccountSummary {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    planCode: row.plan.code,
    subscriptionStatus: subscriptionStatusProto.toProto(
      parseEnum(SubscriptionStatus, row.subscriptionStatus),
    ),
    pinned: row.entitlementsPinned,
    dunningSince:
      row.dunningStartedAt === null ? undefined : toProtoTimestamp(row.dunningStartedAt),
    currentPeriodEnd:
      row.currentPeriodEnd === null ? undefined : toProtoTimestamp(row.currentPeriodEnd),
    entitlementsVersion: String(row.entitlementsVersion),
    createdAt: toProtoTimestamp(row.createdAt),
  };
}

/** The subscription's price, as the account keeps it (after a cancellation too). */
export interface SubscribedPriceRow {
  readonly amountMinor: number;
  readonly currency: string;
  readonly billingInterval: string;
  readonly plan: { readonly code: string };
}

/**
 * The detail: effective grants beside the plan's own, the subscribed plan and its price, recent
 * events (the account's owner on each).
 */
export function toBillingAccountDetail(
  row: BillingAccountRow,
  planGrants: Entitlements,
  subscribed: SubscribedPriceRow | null,
  recentEvents: readonly BillingEventRow[],
  boosts: readonly billingGrpc.AccountBoost[],
): billingGrpc.BillingAccountDetail {
  return {
    summary: toBillingAccountSummary(row),
    ...(row.stripeCustomerId === null ? {} : { stripeCustomerId: row.stripeCustomerId }),
    ...(row.stripeSubscriptionId === null
      ? {}
      : { stripeSubscriptionId: row.stripeSubscriptionId }),
    ...(subscribed === null
      ? {}
      : {
          subscribedPlanCode: subscribed.plan.code,
          subscribedPrice: {
            amountMinor: subscribed.amountMinor,
            currency: parseEnum(CurrencyCode, subscribed.currency),
            billingInterval: billingIntervalProto.toProto(
              parseEnum(BillingInterval, subscribed.billingInterval),
            ),
          },
        }),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    entitlements: toEntitlements(grantsOf(row)),
    planGrants: toEntitlements(planGrants),
    recentEvents: recentEvents.map((event) => toBillingEvent(event, row.ownerUserId)),
    boosts: [...boosts],
  };
}
