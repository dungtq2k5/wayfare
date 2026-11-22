import {
  AnalyticsLevel,
  BillingEventStatus,
  BillingInterval,
  NarrationLanguageScope,
  StripeEndpoint,
  SubscriptionStatus,
} from '@wayfare/contracts';
import {
  analyticsLevelProto,
  billingEventStatusProto,
  billingIntervalProto,
  narrationLanguageScopeProto,
  stripeEndpointProto,
  subscriptionStatusProto,
} from '@wayfare/contracts/grpc';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import { describe, expect, it } from 'vitest';
import {
  toBillingAccountDetail,
  toBillingAccountSummary,
  toBillingEvent,
  toUnpinPreview,
} from './admin-billing.mapper';

const at = new Date('2026-05-01T00:00:00.000Z');
const ts = toProtoTimestamp(at);
const ownerOf = (id: string) => ({ id, name: null, email: null }) as never;
const grants = {
  maxPlaces: 3,
  autoNarration: true,
  narrationLanguageScope: narrationLanguageScopeProto.toProto(NarrationLanguageScope.BASIC),
  maxPhotosPerPlace: 8,
  maxMenuItemsPerPlace: 50,
  discoveryBoostSlots: 1,
  aiCreditsPerDay: 10,
  analyticsLevel: analyticsLevelProto.toProto(AnalyticsLevel.BASIC),
  canSellVouchers: false,
} as billingGrpc.Entitlements;
const summary = (over: Partial<billingGrpc.BillingAccountSummary> = {}) =>
  ({
    id: 'b1',
    ownerUserId: 'o1',
    planCode: 'FREE',
    subscriptionStatus: subscriptionStatusProto.toProto(SubscriptionStatus.NONE),
    pinned: false,
    entitlementsVersion: '4',
    createdAt: ts,
    ...over,
  }) as billingGrpc.BillingAccountSummary;
const event = (over: Partial<billingGrpc.BillingEvent> = {}) =>
  ({
    id: 'e1',
    stripeEventId: 'evt_1',
    endpoint: stripeEndpointProto.toProto(StripeEndpoint.PLATFORM),
    livemode: false,
    eventType: 'invoice.paid',
    stripeCreatedAt: ts,
    status: billingEventStatusProto.toProto(BillingEventStatus.PROCESSED),
    receivedAt: ts,
    payloadJson: '',
    ...over,
  }) as billingGrpc.BillingEvent;

describe('an account row', () => {
  it('names its owner, reads absent dates as null and the version as a number', () => {
    expect(toBillingAccountSummary(summary(), ownerOf)).toMatchObject({
      owner: { id: 'o1' },
      subscriptionStatus: SubscriptionStatus.NONE,
      dunningSince: null,
      currentPeriodEnd: null,
      entitlementsVersion: 4,
    });
    expect(
      toBillingAccountSummary(summary({ dunningSince: ts, currentPeriodEnd: ts }), ownerOf),
    ).toMatchObject({ dunningSince: at.toISOString(), currentPeriodEnd: at.toISOString() });
  });

  it('refuses no account, and a status this build doesn’t know', () => {
    expect(() => toBillingAccountSummary(undefined, ownerOf)).toThrow('billing sent no account');
    expect(() =>
      toBillingAccountSummary(summary({ subscriptionStatus: 99 as never }), ownerOf),
    ).toThrow('billing sent an unknown subscription status');
  });
});

describe('a recorded event', () => {
  it('without an owner, account, error, processing or payload: all null', () => {
    expect(toBillingEvent(event(), ownerOf)).toMatchObject({
      endpoint: StripeEndpoint.PLATFORM,
      status: BillingEventStatus.PROCESSED,
      billingAccountId: null,
      errorLog: null,
      processedAt: null,
      owner: null,
      payload: null,
    });
  });

  it('with them: the owner named and the payload decoded', () => {
    expect(
      toBillingEvent(
        event({
          ownerUserId: 'o1',
          billingAccountId: 'b1',
          errorLog: 'x',
          processedAt: ts,
          payloadJson: '{"id":"evt_1"}',
        }),
        ownerOf,
      ),
    ).toMatchObject({
      owner: { id: 'o1' },
      billingAccountId: 'b1',
      errorLog: 'x',
      processedAt: at.toISOString(),
      payload: { id: 'evt_1' },
    });
  });

  it('refuses no event, and an endpoint this build doesn’t know', () => {
    expect(() => toBillingEvent(undefined, ownerOf)).toThrow('billing sent no event');
    expect(() => toBillingEvent(event({ endpoint: 99 as never }), ownerOf)).toThrow(
      'billing sent an unknown endpoint',
    );
  });
});

describe('an account’s detail', () => {
  const detail = (over: Partial<billingGrpc.BillingAccountDetail> = {}) =>
    ({
      summary: summary(),
      cancelAtPeriodEnd: false,
      entitlements: grants,
      planGrants: grants,
      boosts: [],
      recentEvents: [event()],
      ...over,
    }) as billingGrpc.BillingAccountDetail;

  it('on Free: no Stripe ids, no subscribed plan or price, no payout account', () => {
    expect(toBillingAccountDetail(detail(), ownerOf)).toMatchObject({
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      subscribedPlanCode: null,
      subscribedPrice: null,
      payoutAccount: null,
      recentEvents: [{ id: 'e1' }],
    });
  });

  it('subscribed: the price as USD money with its interval', () => {
    expect(
      toBillingAccountDetail(
        detail({
          stripeCustomerId: 'cus_1',
          stripeSubscriptionId: 'sub_1',
          subscribedPlanCode: 'PRO',
          subscribedPrice: {
            amountMinor: 900,
            billingInterval: billingIntervalProto.toProto(BillingInterval.YEAR),
          },
        } as never),
        ownerOf,
      ),
    ).toMatchObject({
      stripeCustomerId: 'cus_1',
      subscribedPlanCode: 'PRO',
      subscribedPrice: {
        amount: { amountMinor: 900, currency: 'USD' },
        billingInterval: BillingInterval.YEAR,
      },
    });
  });

  it('refuses no account', () => {
    expect(() => toBillingAccountDetail(undefined, ownerOf)).toThrow('billing sent no account');
  });
});

describe('an unpin preview', () => {
  it('reads an absent count as null', () => {
    expect(toUnpinPreview({ grants }).wouldUnpublishPlaces).toBeNull();
    expect(toUnpinPreview({ grants, wouldUnpublishPlaces: 2 }).wouldUnpublishPlaces).toBe(2);
  });
});
