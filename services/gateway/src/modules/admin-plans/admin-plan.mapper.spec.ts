import { AnalyticsLevel, BillingInterval, NarrationLanguageScope } from '@wayfare/contracts';
import {
  analyticsLevelProto,
  billingIntervalProto,
  narrationLanguageScopeProto,
} from '@wayfare/contracts/grpc';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import { describe, expect, it } from 'vitest';
import {
  toAdminPlan,
  toApplyResult,
  toCreatePlanRequest,
  toEntitlements,
  toPriceLookup,
  toRegisterPriceRequest,
  toUpdatePlanRequest,
} from './admin-plan.mapper';

const at = new Date('2026-05-01T00:00:00.000Z');
const ts = toProtoTimestamp(at);
const protoGrants = () =>
  ({
    maxPlaces: 3,
    autoNarration: true,
    narrationLanguageScope: narrationLanguageScopeProto.toProto(NarrationLanguageScope.BASIC),
    maxPhotosPerPlace: 8,
    maxMenuItemsPerPlace: 50,
    discoveryBoostSlots: 1,
    aiCreditsPerDay: 10,
    analyticsLevel: analyticsLevelProto.toProto(AnalyticsLevel.BASIC),
    canSellVouchers: false,
  }) as billingGrpc.Entitlements;
const grants = {
  maxPlaces: 3,
  autoNarration: true,
  narrationLanguageScope: NarrationLanguageScope.BASIC,
  maxPhotosPerPlace: 8,
  maxMenuItemsPerPlace: 50,
  discoveryBoostSlots: 1,
  aiCreditsPerDay: 10,
  analyticsLevel: AnalyticsLevel.BASIC,
  canSellVouchers: false,
  voucherCommissionBps: null,
};

describe('a grant set to billing', () => {
  it('sends a commission only when there is one', () => {
    expect(toEntitlements(grants)).not.toHaveProperty('voucherCommissionBps');
    expect(toEntitlements({ ...grants, voucherCommissionBps: 1500 }).voucherCommissionBps).toBe(
      1500,
    );
  });
});

describe('a catalogue plan', () => {
  const plan = (over: Partial<billingGrpc.AdminPlan> = {}) =>
    ({
      id: 'p1',
      code: 'GROWTH',
      name: 'Growth',
      isActive: true,
      sortOrder: 10,
      grants: protoGrants(),
      prices: [],
      subscriberCount: 4,
      createdAt: ts,
      updatedAt: ts,
      ...over,
    }) as billingGrpc.AdminPlan;

  it('counts subscribers as zero where billing sends no breakdown; no product or retirement', () => {
    expect(toAdminPlan(plan())).toMatchObject({
      stripeProductId: null,
      retiredAt: null,
      subscribers: { total: 4, active: 0, pastDue: 0, cancelling: 0, pinned: 0 },
    });
  });

  it('reads the breakdown, the product and the retirement when billing sends them', () => {
    expect(
      toAdminPlan(
        plan({
          stripeProductId: 'prod_1',
          retiredAt: ts,
          subscribers: { active: 2, pastDue: 1, cancelling: 1, pinned: 0 },
        }),
      ),
    ).toMatchObject({
      stripeProductId: 'prod_1',
      retiredAt: at.toISOString(),
      subscribers: { active: 2, pastDue: 1, cancelling: 1 },
    });
  });

  it('refuses no plan', () => {
    expect(() => toAdminPlan(undefined)).toThrow('billing sent no plan');
  });
});

describe('a price lookup', () => {
  const lookup = {
    amountMinor: 900,
    billingInterval: billingIntervalProto.toProto(BillingInterval.YEAR),
    productId: 'prod_1',
  } as billingGrpc.LookupPriceResponse;

  it('reads Stripe’s answer in USD, the price it replaces only when there is one', () => {
    expect(toPriceLookup(lookup)).toMatchObject({
      amount: { amountMinor: 900, currency: 'USD' },
      interval: BillingInterval.YEAR,
      replaces: null,
    });
    expect(
      toPriceLookup({
        ...lookup,
        replaces: {
          id: 'pr0',
          stripePriceId: 'price_0',
          billingInterval: billingIntervalProto.toProto(BillingInterval.YEAR),
          amountMinor: 800,
          isActive: true,
          createdAt: ts,
        } as billingGrpc.PlanPrice,
      }).replaces,
    ).toMatchObject({ id: 'pr0' });
  });

  it('refuses an interval this build doesn’t know', () => {
    expect(() => toPriceLookup({ ...lookup, billingInterval: 99 as never })).toThrow(
      'billing sent an unknown billing interval',
    );
  });
});

describe('the plan writes', () => {
  it('creates a plan, sending isActive only when given', () => {
    const body = { code: 'PRO', name: 'Pro', sortOrder: 20, grants };
    expect(toCreatePlanRequest(body)).not.toHaveProperty('isActive');
    expect(toCreatePlanRequest({ ...body, isActive: false }).isActive).toBe(false);
  });

  it('updates only what the body carries', () => {
    expect(toUpdatePlanRequest('p1', {})).toEqual({ planId: 'p1', grants: undefined });
    expect(
      toUpdatePlanRequest('p1', { name: 'Pro+', sortOrder: 5, isActive: true, grants }),
    ).toMatchObject({ planId: 'p1', name: 'Pro+', sortOrder: 5, isActive: true, grants: {} });
  });

  it('registers a price with its interval', () => {
    expect(
      toRegisterPriceRequest('p1', {
        stripePriceId: 'price_2',
        billingInterval: BillingInterval.MONTH,
      }),
    ).toEqual({
      planId: 'p1',
      stripePriceId: 'price_2',
      billingInterval: billingIntervalProto.toProto(BillingInterval.MONTH),
    });
  });
});

describe('an apply’s result', () => {
  it('reads an absent count as null, for the run and for each account', () => {
    const result = {
      dryRun: true,
      affected: 1,
      skippedPinned: 0,
      failed: 0,
      wouldEndBoosts: 0,
      accounts: [{ billingAccountId: 'b1', ownerUserId: 'o1', changed: true, failed: false }],
    } as billingGrpc.ApplyPlanResponse;
    expect(toApplyResult(result)).toMatchObject({
      wouldUnpublishPlaces: null,
      accounts: [{ wouldUnpublishPlaces: null }],
    });
    expect(
      toApplyResult({
        ...result,
        wouldUnpublishPlaces: 2,
        accounts: [{ ...result.accounts[0]!, wouldUnpublishPlaces: 1 }],
      }),
    ).toMatchObject({ wouldUnpublishPlaces: 2, accounts: [{ wouldUnpublishPlaces: 1 }] });
  });
});
