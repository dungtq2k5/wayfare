/** Upper bound of a Place's Vietnamese description, in characters (rdm-spec C-1). */
export const MAX_DESCRIPTION_CHARS = 4000;

/** Upper bound of a Place name (rdm-spec C-1, C-4). */
export const MAX_PLACE_NAME_LENGTH = 160;

/** Upper bound of a menu item name (rdm-spec C-6, C-7). */
export const MAX_MENU_ITEM_NAME_LENGTH = 120;

/** Upper bound of a menu item description (rdm-spec C-6, C-7). */
export const MAX_MENU_ITEM_DESCRIPTION_LENGTH = 500;

/** Upper bound of a Tour title (rdm-spec C-9). */
export const MAX_TOUR_TITLE_LENGTH = 160;

/** Upper bound of a reviewer's decision note, shown to the applicant (rdm-spec I-8, C-11, B-7). */
export const MAX_DECISION_NOTE_LENGTH = 1000;

/** Largest accepted upload, in bytes (rdm-spec C-12, product-overview §9). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** The image types an upload may declare (rdm-spec C-12). A MIME allowlist, not an enum. */
export const UPLOAD_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const;
/** An accepted upload content type. */
export type UploadContentType = (typeof UPLOAD_CONTENT_TYPES)[number];

/** Lowest discovery boost weight (rdm-spec C-1 CHECK). */
export const DISCOVERY_BOOST_MIN = 0;
/** Highest discovery boost weight (rdm-spec C-1 CHECK). */
export const DISCOVERY_BOOST_MAX = 100;

/** Lowest price band, `$` (rdm-spec C-1 CHECK). */
export const PRICE_BAND_MIN = 1;
/** Highest price band, `$$$$` (rdm-spec C-1 CHECK). */
export const PRICE_BAND_MAX = 4;

/** Places per delta-sync page (api-endpoints-plan §2.1). */
export const SYNC_PAGE_SIZE = 500;

/** How far behind the newest `sync_version` a sync reads (rdm-spec §1.7). */
export const SYNC_SAFETY_LAG_MS = 5_000;

/** Language-switch warmup radius, in metres (product-overview §9, api-endpoints-plan §4.1). */
export const HOTSET_RADIUS_M = 1500;

/** Language-switch warmup size (product-overview §9, api-endpoints-plan §4.1). */
export const HOTSET_MAX_PLACES = 10;
