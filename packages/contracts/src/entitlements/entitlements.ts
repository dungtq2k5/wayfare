import { z } from 'zod';
import { SubscriptionStatus } from '../billing/enums';
import { BASIC_LANGUAGES, CONTENT_LANGUAGES, LONG_TAIL_LANGUAGES } from '../common/languages';
import type { Language } from '../common/languages';
import { MAX_VOUCHER_COMMISSION_BPS } from '../money/fees';
import { PLATFORM_CEILINGS } from './ceilings';
import type { LimitDimension } from './ceilings';

/** Which languages a plan narrates — rdm-spec B-1 `narration_language_scope`. */
export enum NarrationLanguageScope {
  /** `vi` and `en`. */
  BASIC = 'BASIC',
  /** The five launch languages. */
  LAUNCH = 'LAUNCH',
  /** Launch plus `LONG_TAIL_LANGUAGES`. */
  EXTENDED = 'EXTENDED',
}

/** Every `NarrationLanguageScope` value. */
export const NARRATION_LANGUAGE_SCOPES = Object.values(NarrationLanguageScope);

/** How much of the analytics dashboard a plan shows — rdm-spec B-1 `analytics_level`. */
export enum AnalyticsLevel {
  NONE = 'NONE',
  BASIC = 'BASIC',
  FULL = 'FULL',
}

/** Every `AnalyticsLevel` value. */
export const ANALYTICS_LEVELS = Object.values(AnalyticsLevel);

/** The plan code FREE's grants are read from (rdm-spec B-1, B-3). */
export const FREE_PLAN_CODE = 'FREE';

/** An owner's effective grants — rdm-spec B-3's grant columns, camel-cased. */
export interface Entitlements {
  readonly maxPlaces: number;
  readonly autoNarration: boolean;
  readonly narrationLanguageScope: NarrationLanguageScope;
  readonly maxPhotosPerPlace: number;
  readonly maxMenuItemsPerPlace: number;
  readonly discoveryBoostSlots: number;
  readonly aiCreditsPerDay: number;
  readonly analyticsLevel: AnalyticsLevel;
  readonly canSellVouchers: boolean;
  /** Null exactly when the plan cannot sell vouchers (rdm-spec B-1). */
  readonly voucherCommissionBps: number | null;
}

const count = z.number().int().min(0);

/** `Entitlements` on the wire. */
export const zEntitlements: z.ZodType<Entitlements> = z
  .object({
    maxPlaces: count,
    autoNarration: z.boolean(),
    narrationLanguageScope: z.enum(NarrationLanguageScope),
    maxPhotosPerPlace: count,
    maxMenuItemsPerPlace: count,
    discoveryBoostSlots: count,
    aiCreditsPerDay: count,
    analyticsLevel: z.enum(AnalyticsLevel),
    canSellVouchers: z.boolean(),
    voucherCommissionBps: z.number().int().min(0).max(MAX_VOUCHER_COMMISSION_BPS).nullable(),
  })
  .strict()
  .refine((value) => value.canSellVouchers === (value.voucherCommissionBps !== null), {
    message: 'voucherCommissionBps is set exactly when canSellVouchers is true',
    path: ['voucherCommissionBps'],
  });

/** min(grant, ceiling) — the only way to read a limit (conventions §4.4). */
export function effectiveLimit(dimension: LimitDimension, entitlements: Entitlements): number {
  return Math.min(entitlements[dimension], PLATFORM_CEILINGS[dimension]);
}

/** Statuses under which the subscribed plan's grants apply; any other falls back to FREE (rdm-spec B-3). */
const SUBSCRIBED_PLAN_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.PAST_DUE,
]);

/** True when a subscription status applies the subscribed plan's grants; otherwise FREE's apply (rdm-spec B-3). */
export function subscribedPlanApplies(status: SubscriptionStatus): boolean {
  return SUBSCRIBED_PLAN_STATUSES.has(status);
}

const SCOPE_LANGUAGES: Readonly<Record<NarrationLanguageScope, ReadonlySet<Language>>> = {
  [NarrationLanguageScope.BASIC]: new Set(BASIC_LANGUAGES),
  [NarrationLanguageScope.LAUNCH]: new Set(CONTENT_LANGUAGES),
  [NarrationLanguageScope.EXTENDED]: new Set([...CONTENT_LANGUAGES, ...LONG_TAIL_LANGUAGES]),
};

/** Whether a scope covers a (normalized) language (rdm-spec B-1). */
export function scopeCoversLanguage(scope: NarrationLanguageScope, lang: Language): boolean {
  return SCOPE_LANGUAGES[scope].has(lang);
}

/** True when every limit in `plan` is within its ceiling — checked when a plan is saved (conventions §4.4). */
export function planWithinCeilings(plan: Entitlements): boolean {
  return (Object.keys(PLATFORM_CEILINGS) as LimitDimension[]).every(
    (dimension) => plan[dimension] <= PLATFORM_CEILINGS[dimension],
  );
}
