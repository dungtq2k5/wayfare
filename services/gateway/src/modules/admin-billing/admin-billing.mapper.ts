import type { BillingAccountDetail, BillingAccountSummary, BillingEvent } from '@wayfare/contracts';
import {
  billingEventStatusProto,
  stripeEndpointProto,
  subscriptionStatusProto,
} from '@wayfare/contracts/grpc';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import { fromOptionalProtoTimestamp, fromProtoTimestamp } from '@wayfare/nest-common';
import { toEntitlements } from '../billing/billing.mapper';

/** An enum this build cannot read is a server fault, never a client's. */
function known<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`billing sent an unknown ${what}`);
  return value;
}

/** An account row; an absent optional becomes `null` (conventions §6.3). */
export function toBillingAccountSummary(
  account: billingGrpc.BillingAccountSummary | undefined,
): BillingAccountSummary {
  if (account === undefined) throw new Error('billing sent no account');
  return {
    id: account.id,
    ownerUserId: account.ownerUserId,
    planCode: account.planCode,
    subscriptionStatus: known(
      subscriptionStatusProto.fromProto(account.subscriptionStatus),
      'subscription status',
    ),
    pinned: account.pinned,
    dunningSince:
      fromOptionalProtoTimestamp(account.dunningSince, 'dunningSince')?.toISOString() ?? null,
    currentPeriodEnd:
      fromOptionalProtoTimestamp(account.currentPeriodEnd, 'currentPeriodEnd')?.toISOString() ??
      null,
    entitlementsVersion: Number(account.entitlementsVersion),
    createdAt: fromProtoTimestamp(account.createdAt, 'createdAt').toISOString(),
  };
}

/** A recorded event, its payload decoded. */
export function toBillingEvent(event: billingGrpc.BillingEvent | undefined): BillingEvent {
  if (event === undefined) throw new Error('billing sent no event');
  return {
    id: event.id,
    stripeEventId: event.stripeEventId,
    endpoint: known(stripeEndpointProto.fromProto(event.endpoint), 'endpoint'),
    livemode: event.livemode,
    eventType: event.eventType,
    stripeCreatedAt: fromProtoTimestamp(event.stripeCreatedAt, 'stripeCreatedAt').toISOString(),
    billingAccountId: event.billingAccountId ?? null,
    status: known(billingEventStatusProto.fromProto(event.status), 'event status'),
    errorLog: event.errorLog ?? null,
    receivedAt: fromProtoTimestamp(event.receivedAt, 'receivedAt').toISOString(),
    processedAt:
      fromOptionalProtoTimestamp(event.processedAt, 'processedAt')?.toISOString() ?? null,
    payload: JSON.parse(event.payloadJson) as Record<string, unknown>,
  };
}

/** An account's detail. Boosts and the payout account are empty until Phase 3. */
export function toBillingAccountDetail(
  account: billingGrpc.BillingAccountDetail | undefined,
): BillingAccountDetail {
  if (account === undefined) throw new Error('billing sent no account');
  return {
    ...toBillingAccountSummary(account.summary),
    stripeCustomerId: account.stripeCustomerId ?? null,
    stripeSubscriptionId: account.stripeSubscriptionId ?? null,
    subscribedPlanCode: account.subscribedPlanCode ?? null,
    cancelAtPeriodEnd: account.cancelAtPeriodEnd,
    entitlements: toEntitlements(account.entitlements),
    planGrants: toEntitlements(account.planGrants),
    boosts: [],
    payoutAccount: null,
    recentEvents: account.recentEvents.map(toBillingEvent),
  };
}
