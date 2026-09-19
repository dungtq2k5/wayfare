import { describe, expect, it } from 'vitest';
import { SubscriptionStatus, SUBSCRIPTION_STATUSES } from '../billing/enums';
import { entitlementsReducedData } from '../notifications/data';
import { PLATFORM_CEILINGS } from './ceilings';
import type { LimitDimension } from './ceilings';
import {
  AnalyticsLevel,
  NarrationLanguageScope,
  scopeLanguages,
  zEntitlements,
} from './entitlements';
import type { Entitlements } from './entitlements';
import { FREE_PLAN_GRANTS } from './free-plan';
import { grantsFor, narrowedDimensions, sameGrants, scopeWidened } from './grants';

const growth: Entitlements = {
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

describe('FREE_PLAN_GRANTS', () => {
  it('is a valid grant set with product §8.2 Free column', () => {
    expect(zEntitlements.parse(FREE_PLAN_GRANTS)).toEqual(FREE_PLAN_GRANTS);
    expect(FREE_PLAN_GRANTS).toMatchObject({ maxPlaces: 1, autoNarration: false });
  });
});

describe('grantsFor', () => {
  const applying = new Set([
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.TRIALING,
    SubscriptionStatus.PAST_DUE,
  ]);

  it.each(SUBSCRIPTION_STATUSES.map((status) => [status]))(
    '%s picks the subscribed plan only when the status applies it',
    (status) => {
      expect(grantsFor(growth, FREE_PLAN_GRANTS, status)).toEqual(
        applying.has(status) ? growth : FREE_PLAN_GRANTS,
      );
    },
  );

  it('falls back to Free when nothing was ever subscribed, whatever the status', () => {
    expect(grantsFor(null, FREE_PLAN_GRANTS, SubscriptionStatus.ACTIVE)).toEqual(FREE_PLAN_GRANTS);
  });

  it('reads Free from what it is given, not the seed', () => {
    const editedFree = { ...FREE_PLAN_GRANTS, maxPlaces: 2 };
    expect(grantsFor(growth, editedFree, SubscriptionStatus.CANCELED).maxPlaces).toBe(2);
  });

  it.each((Object.keys(PLATFORM_CEILINGS) as LimitDimension[]).map((dimension) => [dimension]))(
    'bounds %s by its ceiling',
    (dimension) => {
      const wide = { ...growth, [dimension]: PLATFORM_CEILINGS[dimension] + 5 };
      expect(grantsFor(wide, FREE_PLAN_GRANTS, SubscriptionStatus.ACTIVE)[dimension]).toBe(
        PLATFORM_CEILINGS[dimension],
      );
    },
  );
});

describe('narrowedDimensions', () => {
  it('is null for a widening or no change', () => {
    expect(narrowedDimensions(FREE_PLAN_GRANTS, growth)).toBeNull();
    expect(narrowedDimensions(growth, growth)).toBeNull();
    expect(sameGrants(growth, { ...growth })).toBe(true);
  });

  it('names every narrowed dimension, in the notification shape', () => {
    const narrowing = narrowedDimensions(growth, FREE_PLAN_GRANTS);
    expect(narrowing).toEqual({
      reduced: [
        'maxPlaces',
        'maxPhotosPerPlace',
        'maxMenuItemsPerPlace',
        'discoveryBoostSlots',
        'aiCreditsPerDay',
      ],
      autoNarrationLost: true,
      vouchersLost: true,
      languagesReduced: true,
      analyticsReduced: true,
    });
    expect(
      entitlementsReducedData.safeParse({ entitlementsVersion: 3, ...narrowing }).success,
    ).toBe(true);
  });

  it('notices a narrower scope or a lower analytics level alone', () => {
    expect(
      narrowedDimensions(growth, {
        ...growth,
        narrationLanguageScope: NarrationLanguageScope.BASIC,
      }),
    ).toEqual({ reduced: [], languagesReduced: true });
    expect(narrowedDimensions(growth, { ...growth, analyticsLevel: AnalyticsLevel.NONE })).toEqual({
      reduced: [],
      analyticsReduced: true,
    });
  });

  it('orders scopes', () => {
    expect(scopeWidened(NarrationLanguageScope.BASIC, NarrationLanguageScope.LAUNCH)).toBe(true);
    expect(scopeWidened(NarrationLanguageScope.EXTENDED, NarrationLanguageScope.LAUNCH)).toBe(
      false,
    );
  });
});

describe('scopeLanguages', () => {
  it('lists each scope, each covering the one below', () => {
    expect(scopeLanguages(NarrationLanguageScope.BASIC)).toEqual(['vi', 'en']);
    expect(scopeLanguages(NarrationLanguageScope.LAUNCH)).toHaveLength(5);
    expect(scopeLanguages(NarrationLanguageScope.EXTENDED).slice(0, 5)).toEqual(
      scopeLanguages(NarrationLanguageScope.LAUNCH),
    );
  });
});
