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

/** A reviewer's staff-only note on a submission (rdm-spec C-11). */
export const MAX_SUBMISSION_INTERNAL_NOTE_LENGTH = 2000;

/** Largest accepted upload, in bytes (rdm-spec C-12, product-overview §9). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * The image types an upload may declare (rdm-spec C-12). A MIME allowlist, not an enum. No HEIC:
 * the image pipeline cannot decode it, so clients convert to JPEG first.
 */
export const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** An accepted upload content type. */
export type UploadContentType = (typeof UPLOAD_CONTENT_TYPES)[number];

/** How long a signed upload URL stays valid (rdm-spec C-12). */
export const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;

/** The largest image canvas confirm will decode, in pixels (rdm-spec C-12). */
export const MAX_UPLOAD_PIXELS = 50_000_000;

/** The long-edge width of each WebP variant a confirmed photo gets (rdm-spec C-5, C-12). */
export const PHOTO_VARIANT_WIDTHS = { thumb: 320, card: 800, full: 1600 } as const;
/** A photo variant's name. */
export type PhotoVariantName = keyof typeof PHOTO_VARIANT_WIDTHS;

/** The widest nearby search, in metres (api-endpoints-plan §2.1). */
export const MAX_NEARBY_RADIUS_M = 5000;

/** The most items one nearby answer lists (api-endpoints-plan §2.1). */
export const NEARBY_LIMIT_MAX = 50;

/** Upper bound of a Place's address (rdm-spec C-1). */
export const MAX_ADDRESS_LENGTH = 255;

/** Upper bound of a Place's phone number, E.164 (rdm-spec C-1). */
export const MAX_PHONE_LENGTH = 20;

/** Upper bound of a Place's website URL (rdm-spec C-1). */
export const MAX_WEBSITE_URL_LENGTH = 512;

/** Upper bound of a photo's alt text (rdm-spec C-5). */
export const MAX_ALT_TEXT_LENGTH = 255;

/** The most opening-hours rows one Place may have (rdm-spec C-16). */
export const MAX_OPENING_HOURS_ROWS = 50;

/** Crockford base32 without `I L O U` — the alphabet of printed codes (rdm-spec C-1). */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The length of a Place's public code (rdm-spec C-1). */
export const PUBLIC_CODE_LENGTH = 8;

/** A public code: `PUBLIC_CODE_LENGTH` Crockford characters. */
export const PUBLIC_CODE_PATTERN = new RegExp(`^[${CROCKFORD_ALPHABET}]{${PUBLIC_CODE_LENGTH}}$`);

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
