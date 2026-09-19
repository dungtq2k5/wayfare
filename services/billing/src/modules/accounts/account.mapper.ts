import { parseEnum, SubscriptionStatus } from '@wayfare/contracts';
import type { Entitlements } from '@wayfare/contracts';
import { subscriptionStatusProto } from '@wayfare/contracts/grpc';
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

/** The detail: effective grants beside the plan's own, the subscribed plan, recent events. */
export function toBillingAccountDetail(
  row: BillingAccountRow,
  planGrants: Entitlements,
  subscribedPlanCode: string | null,
  recentEvents: readonly BillingEventRow[],
): billingGrpc.BillingAccountDetail {
  return {
    summary: toBillingAccountSummary(row),
    ...(row.stripeCustomerId === null ? {} : { stripeCustomerId: row.stripeCustomerId }),
    ...(row.stripeSubscriptionId === null
      ? {}
      : { stripeSubscriptionId: row.stripeSubscriptionId }),
    ...(subscribedPlanCode === null ? {} : { subscribedPlanCode }),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    entitlements: toEntitlements(grantsOf(row)),
    planGrants: toEntitlements(planGrants),
    recentEvents: recentEvents.map(toBillingEvent),
  };
}
