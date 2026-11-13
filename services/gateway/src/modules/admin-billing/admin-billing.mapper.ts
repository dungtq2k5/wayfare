import type {
  BillingAccountDetail,
  BillingAccountSummary,
  BillingEvent,
  UnpinPreview,
} from '@wayfare/contracts';
import { CurrencyCode } from '@wayfare/contracts';
import {
  billingEventStatusProto,
  billingIntervalProto,
  stripeEndpointProto,
  subscriptionStatusProto,
} from '@wayfare/contracts/grpc';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import { fromOptionalProtoTimestamp, fromProtoTimestamp } from '@wayfare/nest-common';
import { toAccountBoost, toEntitlements } from '../billing/billing.mapper';
import type { OwnerOf } from '../people-names/people-names.service';

/** An enum this build cannot read is a server fault, never a client's. */
function known<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`billing sent an unknown ${what}`);
  return value;
}

/** An account row, its owner named; an absent optional becomes `null` (conventions §6.3). */
export function toBillingAccountSummary(
  account: billingGrpc.BillingAccountSummary | undefined,
  ownerOf: OwnerOf,
): BillingAccountSummary {
  if (account === undefined) throw new Error('billing sent no account');
  return {
    id: account.id,
    ownerUserId: account.ownerUserId,
    owner: ownerOf(account.ownerUserId),
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

/** A recorded event, its owner named, its payload decoded when it came (the single read). */
export function toBillingEvent(
  event: billingGrpc.BillingEvent | undefined,
  ownerOf: OwnerOf,
): BillingEvent {
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
    owner: event.ownerUserId === undefined ? null : ownerOf(event.ownerUserId),
    payload:
      event.payloadJson === '' ? null : (JSON.parse(event.payloadJson) as Record<string, unknown>),
  };
}

/** An account's detail. Boosts and the payout account are empty until Phase 3. */
export function toBillingAccountDetail(
  account: billingGrpc.BillingAccountDetail | undefined,
  ownerOf: OwnerOf,
  placeNames: ReadonlyMap<string, string> = new Map(),
): BillingAccountDetail {
  if (account === undefined) throw new Error('billing sent no account');
  const price = account.subscribedPrice;
  return {
    ...toBillingAccountSummary(account.summary, ownerOf),
    stripeCustomerId: account.stripeCustomerId ?? null,
    stripeSubscriptionId: account.stripeSubscriptionId ?? null,
    subscribedPlanCode: account.subscribedPlanCode ?? null,
    subscribedPrice:
      price === undefined
        ? null
        : {
            // A registered price is USD (rdm-spec B-2), as every plan price the gateway reads.
            amount: { amountMinor: price.amountMinor, currency: CurrencyCode.USD },
            billingInterval: known(
              billingIntervalProto.fromProto(price.billingInterval),
              'billing interval',
            ),
          },
    cancelAtPeriodEnd: account.cancelAtPeriodEnd,
    entitlements: toEntitlements(account.entitlements),
    planGrants: toEntitlements(account.planGrants),
    boosts: account.boosts.map((boost) => toAccountBoost(boost, placeNames)),
    payoutAccount: null,
    recentEvents: account.recentEvents.map((event) => toBillingEvent(event, ownerOf)),
  };
}

/** What unpinning would do; an absent count becomes `null`. */
export function toUnpinPreview(preview: billingGrpc.PreviewUnpinResponse): UnpinPreview {
  return {
    grants: toEntitlements(preview.grants),
    wouldUnpublishPlaces: preview.wouldUnpublishPlaces ?? null,
  };
}
