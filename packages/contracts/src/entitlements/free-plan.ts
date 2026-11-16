import { AnalyticsLevel, NarrationLanguageScope } from './entitlements';
import type { Entitlements } from './entitlements';

/**
 * FREE's grants as first seeded (product-overview §8.2, rdm-spec B-1): one Place, narration on tap
 * only, `vi` and `en`, 3 photos, 10 menu items, nothing else. It only seeds the `FREE` row — from
 * then on the row is the source of Free's grants, and an admin may edit it.
 */
export const FREE_PLAN_GRANTS: Entitlements = {
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
