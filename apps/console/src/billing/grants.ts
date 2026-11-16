import {
  BASIC_LANGUAGES,
  CONTENT_LANGUAGES,
  LONG_TAIL_LANGUAGES,
  MAX_VOUCHER_COMMISSION_BPS,
  PLATFORM_CEILINGS,
  VOUCHERS_AVAILABLE,
} from '@wayfare/contracts';
import type { AdminPlanResponseDtoGrants } from '@wayfare/api-client';
import type { LimitDimension } from '@wayfare/contracts';
import { languageName } from '../i18n/language-names';
import type { Translator } from '../i18n/messages';

/** Every grant, in the order the pages list them (the handoff's §2). */
export const GRANT_KEYS = [
  'maxPlaces',
  'autoNarration',
  'narrationLanguageScope',
  'maxPhotosPerPlace',
  'maxMenuItemsPerPlace',
  'discoveryBoostSlots',
  'aiCreditsPerDay',
  'analyticsLevel',
  'canSellVouchers',
] as const;
export type GrantKey = (typeof GRANT_KEYS)[number];

/** The numeric grants, each bounded by its platform ceiling. */
export const LIMITS: readonly LimitDimension[] = [
  'maxPlaces',
  'maxPhotosPerPlace',
  'maxMenuItemsPerPlace',
  'aiCreditsPerDay',
  'discoveryBoostSlots',
];

/** The lowest each limit may be: an owner on any plan has at least one Place. */
export const LIMIT_MIN: Readonly<Record<LimitDimension, number>> = {
  maxPlaces: 1,
  maxPhotosPerPlace: 0,
  maxMenuItemsPerPlace: 0,
  discoveryBoostSlots: 0,
  aiCreditsPerDay: 0,
};

/** The commission's largest percentage (rdm-spec B-1's basis points, as a person types them). */
export const MAX_COMMISSION_PERCENT = MAX_VOUCHER_COMMISSION_BPS / 100;

/** A grant set as the API carries it. */
export type Entitlements = AdminPlanResponseDtoGrants;

const isLimit = (key: GrantKey): key is LimitDimension => (LIMITS as string[]).includes(key);

/** A grant's name, as its row and its field say it. */
export const grantLabel = (key: GrantKey, { tDynamic }: Translator): string =>
  tDynamic(`grants.${key}`);

/** A grant's value in words: "10", "On — its Venues play…", "Yes, 15 % commission". */
export function grantValue(
  key: GrantKey,
  grants: Entitlements,
  { t, tDynamic }: Translator,
  /** The account's columns (W2): auto-narration as "On" or "Off — on tap only". */
  short = false,
) {
  switch (key) {
    case 'autoNarration':
      if (short) return grants.autoNarration ? t('grants.on') : t('grants.offShort');
      return grants.autoNarration ? t('grants.autoOn') : t('grants.autoOff');
    case 'narrationLanguageScope':
      return tDynamic(`grants.scope.${grants.narrationLanguageScope}`);
    case 'analyticsLevel':
      return tDynamic(`grants.analytics.${grants.analyticsLevel}`);
    case 'canSellVouchers':
      return grants.voucherCommissionBps === null
        ? t('grants.vouchersNo')
        : t('grants.vouchersYes', { n: grants.voucherCommissionBps / 100 });
    default:
      return String(grants[key]);
  }
}

/** Whether staff see the voucher grant as paused: vouchers aren't sold yet (ADR 0066). */
export const vouchersPaused = (available = VOUCHERS_AVAILABLE): boolean => !available;

/** Whether a grant carries the *Paused* chip: voucher selling held while it's paused; "No" never. */
export const grantPaused = (
  key: GrantKey,
  grants: Entitlements,
  available = VOUCHERS_AVAILABLE,
): boolean => key === 'canSellVouchers' && grants.canSellVouchers && vouchersPaused(available);

/** The languages a scope narrates, by name: the launch five, or "Also …" the long tail. */
export function scopeLanguages(
  scope: Entitlements['narrationLanguageScope'],
  translator: Translator,
): string {
  const names = (codes: readonly string[]) =>
    codes.map((code) => languageName(code, translator.locale)).join(', ');
  if (scope === 'BASIC') return names(BASIC_LANGUAGES);
  if (scope === 'LAUNCH') return names(CONTENT_LANGUAGES);
  return translator.t('grants.also', { languages: names(LONG_TAIL_LANGUAGES) });
}

/**
 * What sits beside a grant on a plan's page (B2): its ceiling where the grant is a limit — "The
 * platform allows 100", or "The most the platform allows" at it — the languages a scope means, the
 * commission's most, auto-narration's rule that money never buys narration; nothing for the rest.
 */
export function grantNote(key: GrantKey, grants: Entitlements, translator: Translator) {
  const { t } = translator;
  if (isLimit(key))
    return grants[key] >= PLATFORM_CEILINGS[key]
      ? t('grants.atCeiling')
      : t('grants.ceiling', { n: PLATFORM_CEILINGS[key] });
  // Required beside auto-narration on every plan (ADR 0007): a plan never buys narration.
  if (key === 'autoNarration') return t('grants.autoNote');
  if (key === 'narrationLanguageScope')
    return scopeLanguages(grants.narrationLanguageScope, translator);
  if (key === 'canSellVouchers' && grants.canSellVouchers)
    return t('grants.commissionCeiling', { n: MAX_COMMISSION_PERCENT });
  return null;
}

/** The grants as a form holds them: numbers as typed, so an empty field stays empty. */
export interface GrantsDraft {
  maxPlaces: string;
  maxPhotosPerPlace: string;
  maxMenuItemsPerPlace: string;
  discoveryBoostSlots: string;
  aiCreditsPerDay: string;
  autoNarration: boolean | null;
  narrationLanguageScope: Entitlements['narrationLanguageScope'] | null;
  analyticsLevel: Entitlements['analyticsLevel'] | null;
  canSellVouchers: boolean;
  commissionPercent: string;
}

/** An empty draft: a plan states every grant, and none has a default (B3). */
export const EMPTY_DRAFT: GrantsDraft = {
  maxPlaces: '',
  maxPhotosPerPlace: '',
  maxMenuItemsPerPlace: '',
  discoveryBoostSlots: '',
  aiCreditsPerDay: '',
  autoNarration: null,
  narrationLanguageScope: null,
  analyticsLevel: null,
  canSellVouchers: false,
  commissionPercent: '',
};

/** A grant set as a draft, for an edit. */
export const draftOf = (grants: Entitlements): GrantsDraft => ({
  maxPlaces: String(grants.maxPlaces),
  maxPhotosPerPlace: String(grants.maxPhotosPerPlace),
  maxMenuItemsPerPlace: String(grants.maxMenuItemsPerPlace),
  discoveryBoostSlots: String(grants.discoveryBoostSlots),
  aiCreditsPerDay: String(grants.aiCreditsPerDay),
  autoNarration: grants.autoNarration,
  narrationLanguageScope: grants.narrationLanguageScope,
  analyticsLevel: grants.analyticsLevel,
  canSellVouchers: grants.canSellVouchers,
  commissionPercent:
    grants.voucherCommissionBps === null ? '' : String(grants.voucherCommissionBps / 100),
});

const WHOLE = /^\d+$/;

/**
 * A draft checked before sending (K12): each limit a whole number within its range — above its
 * ceiling, the API's sentence ("The platform allows at most 8 photos per Place") — each choice made,
 * and the commission only while vouchers are sold. The grants, or the errors by field.
 */
export function checkGrants(
  draft: GrantsDraft,
  translator: Translator,
): { grants: Entitlements; errors: null } | { grants: null; errors: Record<string, string> } {
  const { t, tDynamic } = translator;
  const errors: Record<string, string> = {};
  const numbers: Partial<Record<LimitDimension, number>> = {};
  for (const key of LIMITS) {
    const text = draft[key].trim();
    const value = Number(text);
    if (text === '') errors[key] = t('issue.required');
    else if (!WHOLE.test(text) || value < LIMIT_MIN[key])
      errors[key] = t('grants.range', { min: LIMIT_MIN[key], max: PLATFORM_CEILINGS[key] });
    else if (value > PLATFORM_CEILINGS[key])
      errors[key] = t('grants.overCeiling', {
        max: PLATFORM_CEILINGS[key],
        grant: tDynamic(`grants.noun.${key}`),
      });
    else numbers[key] = value;
  }
  if (draft.autoNarration === null) errors.autoNarration = t('issue.required');
  if (draft.narrationLanguageScope === null) errors.narrationLanguageScope = t('issue.required');
  if (draft.analyticsLevel === null) errors.analyticsLevel = t('issue.required');
  let commission: number | null = null;
  if (draft.canSellVouchers) {
    const text = draft.commissionPercent.trim();
    const value = Number(text);
    if (text === '') errors.commissionPercent = t('issue.required');
    else if (!WHOLE.test(text) || value > MAX_COMMISSION_PERCENT)
      errors.commissionPercent = t('grants.range', { min: 0, max: MAX_COMMISSION_PERCENT });
    else commission = value * 100;
  }
  if (Object.keys(errors).length > 0) return { grants: null, errors };
  return {
    grants: {
      maxPlaces: numbers.maxPlaces!,
      maxPhotosPerPlace: numbers.maxPhotosPerPlace!,
      maxMenuItemsPerPlace: numbers.maxMenuItemsPerPlace!,
      discoveryBoostSlots: numbers.discoveryBoostSlots!,
      aiCreditsPerDay: numbers.aiCreditsPerDay!,
      autoNarration: draft.autoNarration!,
      narrationLanguageScope: draft.narrationLanguageScope!,
      analyticsLevel: draft.analyticsLevel!,
      canSellVouchers: draft.canSellVouchers,
      voucherCommissionBps: commission,
    },
    errors: null,
  };
}

/**
 * The grants as typed, whether or not they pass: a number that isn't whole keeps `fallback`'s. What
 * changes (W3) lists what was typed; the field's own error says when it is refused.
 */
export function typedGrants(draft: GrantsDraft, fallback: Entitlements): Entitlements {
  const whole = (text: string, previous: number) =>
    WHOLE.test(text.trim()) ? Number(text.trim()) : previous;
  const commission = whole(draft.commissionPercent, (fallback.voucherCommissionBps ?? 0) / 100);
  return {
    maxPlaces: whole(draft.maxPlaces, fallback.maxPlaces),
    maxPhotosPerPlace: whole(draft.maxPhotosPerPlace, fallback.maxPhotosPerPlace),
    maxMenuItemsPerPlace: whole(draft.maxMenuItemsPerPlace, fallback.maxMenuItemsPerPlace),
    discoveryBoostSlots: whole(draft.discoveryBoostSlots, fallback.discoveryBoostSlots),
    aiCreditsPerDay: whole(draft.aiCreditsPerDay, fallback.aiCreditsPerDay),
    autoNarration: draft.autoNarration ?? fallback.autoNarration,
    narrationLanguageScope: draft.narrationLanguageScope ?? fallback.narrationLanguageScope,
    analyticsLevel: draft.analyticsLevel ?? fallback.analyticsLevel,
    canSellVouchers: draft.canSellVouchers,
    voucherCommissionBps: draft.canSellVouchers ? commission * 100 : null,
  };
}

/** Money as Stripe states it: "$9.00" (K13), in either language. */
export const formatMoney = (money: { amountMinor: number; currency: string }): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: money.currency }).format(
    money.amountMinor / 100,
  );
