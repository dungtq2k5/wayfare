/** The numeric grants a platform ceiling bounds (conventions §4.4). */
export type LimitDimension =
  | 'maxPlaces'
  | 'maxPhotosPerPlace'
  | 'maxMenuItemsPerPlace'
  | 'discoveryBoostSlots'
  | 'aiCreditsPerDay';

/** Places per owner, whatever the plan — twice Pro's 50, room for a negotiated plan. */
export const MAX_PLACES_PER_OWNER = 100;

/** Photos per Place (rdm-spec C-5, product-overview §9). */
export const MAX_PHOTOS_PER_PLACE = 8;

/** Menu items per Place (rdm-spec C-6). */
export const MAX_MENU_ITEMS_PER_PLACE = 200;

/** Discovery boost slots per owner. */
export const MAX_DISCOVERY_BOOST_SLOTS = 10;

/** AI credits per owner per day — the headroom above the plans' 10 (product-overview §8.2, §9). */
export const MAX_AI_CREDITS_PER_DAY = 50;

/** Every ceiling, by the grant it bounds (conventions §4.4). */
export const PLATFORM_CEILINGS: Readonly<Record<LimitDimension, number>> = {
  maxPlaces: MAX_PLACES_PER_OWNER,
  maxPhotosPerPlace: MAX_PHOTOS_PER_PLACE,
  maxMenuItemsPerPlace: MAX_MENU_ITEMS_PER_PLACE,
  discoveryBoostSlots: MAX_DISCOVERY_BOOST_SLOTS,
  aiCreditsPerDay: MAX_AI_CREDITS_PER_DAY,
};
