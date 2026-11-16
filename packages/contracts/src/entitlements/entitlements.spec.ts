import { describe, expect, it } from 'vitest';
import { SUBSCRIPTION_STATUSES, SubscriptionStatus } from '../billing/enums';
import { LONG_TAIL_LANGUAGES } from '../common/languages';
import { MAX_AI_CREDITS_PER_DAY, PLATFORM_CEILINGS } from './ceilings';
import {
  AnalyticsLevel,
  effectiveLimit,
  NarrationLanguageScope,
  planWithinCeilings,
  scopeCoversLanguage,
  subscribedPlanApplies,
  zEntitlements,
} from './entitlements';
import type { Entitlements } from './entitlements';

// product-overview §8.2 — fixture data for the seed, not constants.
const free: Entitlements = {
  maxPlaces: 1,
  autoNarration: false,
  narrationLanguageScope: NarrationLanguageScope.BASIC,
  maxPhotosPerPlace: 3,
  maxMenuItemsPerPlace: 10,
  discoveryBoostSlots: 0,
  aiCreditsPerDay: 0,
  analyticsLevel: AnalyticsLevel.NONE,
  canSellVouchers: false,
  voucherCommissionBps: null,
};
const growth: Entitlements = {
  ...free,
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
const pro: Entitlements = {
  ...growth,
  maxPlaces: 50,
  narrationLanguageScope: NarrationLanguageScope.EXTENDED,
  discoveryBoostSlots: 5,
  analyticsLevel: AnalyticsLevel.FULL,
  voucherCommissionBps: 1000,
};

describe('entitlements', () => {
  it.each([
    ['Free', free],
    ['Growth', growth],
    ['Pro', pro],
  ])('the %s plan is within the platform ceilings and valid on the wire', (_name, plan) => {
    expect(planWithinCeilings(plan)).toBe(true);
    expect(zEntitlements.safeParse(plan).success).toBe(true);
  });

  it('refuses a plan above a ceiling', () => {
    expect(planWithinCeilings({ ...pro, aiCreditsPerDay: MAX_AI_CREDITS_PER_DAY + 1 })).toBe(false);
  });

  it('reads a limit as min(grant, ceiling)', () => {
    expect(effectiveLimit('maxPlaces', pro)).toBe(50);
    expect(effectiveLimit('maxPlaces', { ...pro, maxPlaces: 1000 })).toBe(
      PLATFORM_CEILINGS.maxPlaces,
    );
  });

  it('sets a commission exactly when vouchers can be sold', () => {
    expect(zEntitlements.safeParse({ ...free, voucherCommissionBps: 1500 }).success).toBe(false);
    expect(zEntitlements.safeParse({ ...growth, voucherCommissionBps: null }).success).toBe(false);
    expect(zEntitlements.safeParse({ ...growth, voucherCommissionBps: 3001 }).success).toBe(false);
  });

  it('decides for every subscription status whether the subscribed plan applies', () => {
    const applies = new Set([
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.TRIALING,
      SubscriptionStatus.PAST_DUE,
    ]);
    // A new status fails here until someone decides which side it falls on.
    expect(SUBSCRIPTION_STATUSES).toHaveLength(9);
    for (const status of SUBSCRIPTION_STATUSES) {
      expect(subscribedPlanApplies(status), status).toBe(applies.has(status));
    }
  });

  it('scopes languages', () => {
    expect(scopeCoversLanguage(NarrationLanguageScope.BASIC, 'en')).toBe(true);
    expect(scopeCoversLanguage(NarrationLanguageScope.BASIC, 'ja')).toBe(false);
    expect(scopeCoversLanguage(NarrationLanguageScope.LAUNCH, 'zh-Hans')).toBe(true);
    expect(scopeCoversLanguage(NarrationLanguageScope.LAUNCH, 'fr')).toBe(false);
    for (const lang of LONG_TAIL_LANGUAGES) {
      expect(scopeCoversLanguage(NarrationLanguageScope.EXTENDED, lang)).toBe(true);
    }
  });
});
