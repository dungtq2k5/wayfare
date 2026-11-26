import {
  AnalyticsLevel,
  BillingInterval,
  BoostEndedReason,
  NarrationLanguageScope,
  SubscriptionStatus,
} from '@wayfare/contracts';
import {
  analyticsLevelProto,
  billingIntervalProto,
  boostEndedReasonProto,
  narrationLanguageScopeProto,
  subscriptionStatusProto,
} from '@wayfare/contracts/grpc';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import { describe, expect, it } from 'vitest';
import {
  toAccountBoost,
  toBillingOverview,
  toBillingSummary,
  toEntitlements,
  toInvoice,
  toOwnerBoosts,
  toPlaceBoost,
  toPlan,
  toPlanPrice,
} from './billing.mapper';

const at = new Date('2026-05-01T00:00:00.000Z');
const ts = toProtoTimestamp(at);
const protoGrants = (over: Partial<billingGrpc.Entitlements> = {}) => ({
  maxPlaces: 3,
  autoNarration: true,
  narrationLanguageScope: narrationLanguageScopeProto.toProto(NarrationLanguageScope.BASIC),
  maxPhotosPerPlace: 8,
  maxMenuItemsPerPlace: 50,
  discoveryBoostSlots: 1,
  aiCreditsPerDay: 10,
  analyticsLevel: analyticsLevelProto.toProto(AnalyticsLevel.BASIC),
  canSellVouchers: false,
  ...over,
});
const protoPrice = (over: Partial<billingGrpc.PlanPrice> = {}) =>
  ({
    id: 'pr1',
    stripePriceId: 'price_1',
    billingInterval: billingIntervalProto.toProto(BillingInterval.MONTH),
    amountMinor: 900,
    isActive: true,
    createdAt: ts,
    ...over,
  }) as billingGrpc.PlanPrice;

describe('a grant set from billing', () => {
  it('reads an absent commission as null, a present one as itself', () => {
    expect(toEntitlements(protoGrants()).voucherCommissionBps).toBeNull();
    expect(toEntitlements(protoGrants({ voucherCommissionBps: 1500 })).voucherCommissionBps).toBe(
      1500,
    );
  });

  it('refuses no grants, and a scope or level this build doesn’t know: a server fault', () => {
    expect(() => toEntitlements(undefined)).toThrow('billing sent no grants');
    expect(() => toEntitlements(protoGrants({ narrationLanguageScope: 99 as never }))).toThrow(
      'billing sent an unknown narration scope',
    );
    expect(() => toEntitlements(protoGrants({ analyticsLevel: 99 as never }))).toThrow(
      'billing sent an unknown analytics level',
    );
  });
});

describe('a price and a plan', () => {
  it('reads a price as money in USD, replaced only when billing says so', () => {
    expect(toPlanPrice(protoPrice())).toMatchObject({
      billingInterval: BillingInterval.MONTH,
      amount: { amountMinor: 900, currency: 'USD' },
      replacedAt: null,
    });
    expect(toPlanPrice(protoPrice({ replacedAt: ts })).replacedAt).toBe(at.toISOString());
  });

  it('refuses an interval this build doesn’t know', () => {
    expect(() => toPlanPrice(protoPrice({ billingInterval: 99 as never }))).toThrow(
      'billing sent an unknown interval',
    );
  });

  it('reads a plan with its grants and prices', () => {
    expect(
      toPlan({ id: 'p1', code: 'GROWTH', name: 'Growth', grants: protoGrants(), prices: [] }),
    ).toMatchObject({ code: 'GROWTH', prices: [], grants: { maxPlaces: 3 } });
  });
});

describe('the owner’s overview', () => {
  const overview = (over: Partial<billingGrpc.GetOverviewResponse> = {}) =>
    ({
      plan: { id: 'p1', code: 'FREE', name: 'Free' },
      subscriptionStatus: subscriptionStatusProto.toProto(SubscriptionStatus.NONE),
      cancelAtPeriodEnd: false,
      entitlements: protoGrants(),
      planGrants: protoGrants(),
      usageBoostsLive: 0,
      pinned: false,
      ...over,
    }) as billingGrpc.GetOverviewResponse;

  it('on Free: no price, period, dunning or place count', () => {
    expect(toBillingOverview(overview())).toMatchObject({
      price: null,
      currentPeriodEnd: null,
      dunning: null,
      usage: { places: null, boostsLive: 0 },
    });
  });

  it('subscribed and past due: the price, the period’s end, and since when it’s owed', () => {
    expect(
      toBillingOverview(
        overview({
          price: protoPrice(),
          currentPeriodEnd: ts,
          dunningSince: ts,
          usagePlaces: 2,
          subscriptionStatus: subscriptionStatusProto.toProto(SubscriptionStatus.PAST_DUE),
        }),
      ),
    ).toMatchObject({
      price: { id: 'pr1' },
      currentPeriodEnd: at.toISOString(),
      dunning: { since: at.toISOString() },
      usage: { places: 2 },
      subscriptionStatus: SubscriptionStatus.PAST_DUE,
    });
  });

  it('refuses an overview without its plan, or with a status this build doesn’t know', () => {
    expect(() => toBillingOverview(overview({ plan: undefined }))).toThrow(
      'billing sent an overview without its plan',
    );
    expect(() => toBillingOverview(overview({ subscriptionStatus: 99 as never }))).toThrow(
      'billing sent an unknown subscription status',
    );
  });
});

describe('an invoice and the account summary', () => {
  it('reads an invoice’s amounts as money, its absent number and links as null', () => {
    const invoice = {
      id: 'in1',
      status: 'paid',
      totalMinor: 900,
      amountPaidMinor: 900,
      createdAt: ts,
    } as billingGrpc.Invoice;
    expect(toInvoice(invoice)).toMatchObject({
      number: null,
      hostedInvoiceUrl: null,
      invoicePdfUrl: null,
      total: { amountMinor: 900, currency: 'USD' },
    });
    expect(
      toInvoice({
        ...invoice,
        number: 'A-1',
        hostedInvoiceUrl: 'https://pay.test/i',
        invoicePdfUrl: 'https://pay.test/i.pdf',
      }),
    ).toMatchObject({
      number: 'A-1',
      hostedInvoiceUrl: 'https://pay.test/i',
      invoicePdfUrl: 'https://pay.test/i.pdf',
    });
  });

  it('reads the summary’s dunning date only when there is one', () => {
    const summary = {
      planCode: 'GROWTH',
      subscriptionStatus: subscriptionStatusProto.toProto(SubscriptionStatus.ACTIVE),
    } as billingGrpc.GetBillingSummaryResponse;
    expect(toBillingSummary(summary).dunningSince).toBeNull();
    expect(toBillingSummary({ ...summary, dunningSince: ts }).dunningSince).toBe(at.toISOString());
  });
});

describe('boosts', () => {
  const live = { placeId: 'p1', weight: 50, since: ts } as billingGrpc.AccountBoost;
  const ended = {
    placeId: 'p2',
    weight: 50,
    since: ts,
    endedAt: ts,
    endedReason: boostEndedReasonProto.toProto(BoostEndedReason.OWNER),
  } as billingGrpc.AccountBoost;

  it('reads a live boost with no end and no reason; its Place named only when known', () => {
    expect(toAccountBoost(live)).toMatchObject({
      placeName: null,
      endedAt: null,
      endedReason: null,
    });
    expect(toAccountBoost(live, new Map([['p1', 'Bến Thành']])).placeName).toBe('Bến Thành');
  });

  it('splits the owner’s boosts into live and ended, an ended one with why', () => {
    expect(toOwnerBoosts({ slots: 2, boosts: [live, ended] })).toEqual({
      slots: 2,
      live: [{ placeId: 'p1', since: at.toISOString() }],
      ended: [
        {
          placeId: 'p2',
          since: at.toISOString(),
          endedAt: at.toISOString(),
          endedReason: BoostEndedReason.OWNER,
        },
      ],
    });
  });

  it('leaves out an ended boost whose reason this build can’t read', () => {
    expect(
      toOwnerBoosts({ slots: 1, boosts: [{ ...ended, endedReason: 99 as never }] }).ended,
    ).toEqual([]);
  });

  it('reads a Place’s live boost for the admin', () => {
    expect(toPlaceBoost({ since: ts, billingAccountId: 'b1', planCode: 'PRO', slots: 3 })).toEqual({
      since: at.toISOString(),
      billingAccountId: 'b1',
      planCode: 'PRO',
      slots: 3,
    });
  });
});
