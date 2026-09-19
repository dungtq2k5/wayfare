import type { SubscriptionStatus } from '../billing/enums';
import type { EntitlementsReducedData } from '../notifications/data';
import { PLATFORM_CEILINGS } from './ceilings';
import type { LimitDimension } from './ceilings';
import { AnalyticsLevel, NarrationLanguageScope, subscribedPlanApplies } from './entitlements';
import type { Entitlements } from './entitlements';

const DIMENSIONS = Object.keys(PLATFORM_CEILINGS) as LimitDimension[];

const SCOPE_RANK: Readonly<Record<NarrationLanguageScope, number>> = {
  [NarrationLanguageScope.BASIC]: 0,
  [NarrationLanguageScope.LAUNCH]: 1,
  [NarrationLanguageScope.EXTENDED]: 2,
};

const ANALYTICS_RANK: Readonly<Record<AnalyticsLevel, number>> = {
  [AnalyticsLevel.NONE]: 0,
  [AnalyticsLevel.BASIC]: 1,
  [AnalyticsLevel.FULL]: 2,
};

/** Each numeric grant bounded by its platform ceiling (conventions §4.4). */
export function withinCeilings(grants: Entitlements): Entitlements {
  const bounded: Record<LimitDimension, number> = { ...grants };
  for (const dimension of DIMENSIONS) {
    bounded[dimension] = Math.min(grants[dimension], PLATFORM_CEILINGS[dimension]);
  }
  return { ...grants, ...bounded };
}

/**
 * The one grant function (rdm-spec B-3): the subscribed plan's grants while the status applies
 * them, else FREE's — both plans as the database holds them — each numeric grant bounded by its
 * ceiling. `subscribedPlan` is null for an account that never subscribed.
 */
export function grantsFor(
  subscribedPlan: Entitlements | null,
  freePlan: Entitlements,
  status: SubscriptionStatus,
): Entitlements {
  const plan = subscribedPlan !== null && subscribedPlanApplies(status) ? subscribedPlan : freePlan;
  return withinCeilings(plan);
}

/** True when two grant sets are the same, field by field. */
export function sameGrants(a: Entitlements, b: Entitlements): boolean {
  return (Object.keys(a) as (keyof Entitlements)[]).every((key) => a[key] === b[key]);
}

/** What a change of grants took away, as `ENTITLEMENTS_REDUCED` says it — without the version. */
export type EntitlementsNarrowing = Omit<EntitlementsReducedData, 'entitlementsVersion'>;

/**
 * What narrowed from `previous` to `next` (api-endpoints-plan §10): smaller numeric grants, lost
 * auto-narration or vouchers, a smaller language scope, a lower analytics level. Null when nothing
 * did — a widening, or an unchanged set.
 */
export function narrowedDimensions(
  previous: Entitlements,
  next: Entitlements,
): EntitlementsNarrowing | null {
  const reduced = DIMENSIONS.filter((dimension) => next[dimension] < previous[dimension]);
  const autoNarrationLost = previous.autoNarration && !next.autoNarration;
  const vouchersLost = previous.canSellVouchers && !next.canSellVouchers;
  const languagesReduced =
    SCOPE_RANK[next.narrationLanguageScope] < SCOPE_RANK[previous.narrationLanguageScope];
  const analyticsReduced =
    ANALYTICS_RANK[next.analyticsLevel] < ANALYTICS_RANK[previous.analyticsLevel];
  if (
    reduced.length === 0 &&
    !autoNarrationLost &&
    !vouchersLost &&
    !languagesReduced &&
    !analyticsReduced
  ) {
    return null;
  }
  return {
    reduced,
    ...(autoNarrationLost ? { autoNarrationLost } : {}),
    ...(vouchersLost ? { vouchersLost } : {}),
    ...(languagesReduced ? { languagesReduced } : {}),
    ...(analyticsReduced ? { analyticsReduced } : {}),
  };
}

/** True when `next`'s language scope covers more than `previous`'s. */
export function scopeWidened(
  previous: NarrationLanguageScope,
  next: NarrationLanguageScope,
): boolean {
  return SCOPE_RANK[next] > SCOPE_RANK[previous];
}
