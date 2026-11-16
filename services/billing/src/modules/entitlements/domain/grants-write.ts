import { AnalyticsLevel, NarrationLanguageScope, parseEnum, sameGrants } from '@wayfare/contracts';
import type { Entitlements } from '@wayfare/contracts';

/** The grant columns B-1 and B-3 share (rdm-spec B-1, B-3). */
export interface GrantColumns {
  readonly maxPlaces: number;
  readonly autoNarration: boolean;
  readonly narrationLanguageScope: string;
  readonly maxPhotosPerPlace: number;
  readonly maxMenuItemsPerPlace: number;
  readonly discoveryBoostSlots: number;
  readonly aiCreditsPerDay: number;
  readonly analyticsLevel: string;
  readonly canSellVouchers: boolean;
  readonly voucherCommissionBps: number | null;
}

/** A plan's or an account's grants, as `Entitlements`. */
export function grantsOf(columns: GrantColumns): Entitlements {
  return {
    maxPlaces: columns.maxPlaces,
    autoNarration: columns.autoNarration,
    narrationLanguageScope: parseEnum(NarrationLanguageScope, columns.narrationLanguageScope),
    maxPhotosPerPlace: columns.maxPhotosPerPlace,
    maxMenuItemsPerPlace: columns.maxMenuItemsPerPlace,
    discoveryBoostSlots: columns.discoveryBoostSlots,
    aiCreditsPerDay: columns.aiCreditsPerDay,
    analyticsLevel: parseEnum(AnalyticsLevel, columns.analyticsLevel),
    canSellVouchers: columns.canSellVouchers,
    voucherCommissionBps: columns.voucherCommissionBps,
  };
}

/** `Entitlements` as the grant columns a write sets. */
export function grantColumns(grants: Entitlements): GrantColumns {
  return { ...grants };
}

/** What writing `next` over `current` does: nothing, or a new version. */
export type GrantsWrite =
  | { readonly changed: false; readonly version: number }
  | { readonly changed: true; readonly version: number; readonly previous: Entitlements };

/**
 * The version rule (rdm-spec B-3): a change bumps `entitlements_version` by one and publishes; an
 * unchanged recompute writes nothing.
 */
export function plannedGrantsWrite(
  current: Entitlements,
  currentVersion: number,
  next: Entitlements,
): GrantsWrite {
  return sameGrants(current, next)
    ? { changed: false, version: currentVersion }
    : { changed: true, version: currentVersion + 1, previous: current };
}
