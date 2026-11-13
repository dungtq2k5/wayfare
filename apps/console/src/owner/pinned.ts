import { VOUCHERS_AVAILABLE } from '@wayfare/contracts';

/** The grants a pin can set, as both reads carry them. */
export interface PinnableGrants {
  readonly maxPlaces: number;
  readonly autoNarration: boolean;
  readonly narrationLanguageScope: string;
  readonly maxPhotosPerPlace: number;
  readonly maxMenuItemsPerPlace: number;
  readonly discoveryBoostSlots: number;
  readonly aiCreditsPerDay: number;
  readonly analyticsLevel: string;
  readonly canSellVouchers: boolean;
}

/** One limit a pin set, as Y1c names it: its copy key and its value. */
export type PinnedLimit =
  | {
      readonly key:
        | 'pin.maxPlaces'
        | 'pin.maxPhotosPerPlace'
        | 'pin.maxMenuItemsPerPlace'
        | 'pin.aiCreditsPerDay'
        | 'pin.discoveryBoostSlots';
      readonly n: number;
    }
  | {
      readonly key:
        'pin.autoNarrationOn' | 'pin.autoNarrationOff' | 'pin.vouchersOn' | 'pin.vouchersOff';
    }
  | { readonly key: 'scope'; readonly scope: string }
  | { readonly key: 'analytics'; readonly level: string };

const COUNTS = [
  'maxPlaces',
  'maxPhotosPerPlace',
  'maxMenuItemsPerPlace',
  'aiCreditsPerDay',
  'discoveryBoostSlots',
] as const;

/**
 * The limits a pin set by hand (Y1c): each grant in force that differs from the plan's own, in the
 * order the page lists them. The limits a pin left as the plan has them are not named, nor voucher
 * selling while vouchers aren't sold (ADR 0066): an owner is never told of a grant they can't use.
 */
export function pinnedLimits(
  inForce: PinnableGrants,
  plan: PinnableGrants,
  vouchersAvailable = VOUCHERS_AVAILABLE,
): PinnedLimit[] {
  const limits: PinnedLimit[] = [];
  for (const grant of COUNTS) {
    if (inForce[grant] !== plan[grant]) limits.push({ key: `pin.${grant}`, n: inForce[grant] });
  }
  if (inForce.autoNarration !== plan.autoNarration)
    limits.push({ key: inForce.autoNarration ? 'pin.autoNarrationOn' : 'pin.autoNarrationOff' });
  if (inForce.narrationLanguageScope !== plan.narrationLanguageScope)
    limits.push({ key: 'scope', scope: inForce.narrationLanguageScope });
  if (inForce.analyticsLevel !== plan.analyticsLevel)
    limits.push({ key: 'analytics', level: inForce.analyticsLevel });
  if (vouchersAvailable && inForce.canSellVouchers !== plan.canSellVouchers)
    limits.push({ key: inForce.canSellVouchers ? 'pin.vouchersOn' : 'pin.vouchersOff' });
  return limits;
}
