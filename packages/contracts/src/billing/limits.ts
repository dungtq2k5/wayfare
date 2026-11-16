/** Active or invited staff per seller (rdm-spec B-13, api-endpoints-plan §5.7). */
export const MAX_STAFF_PER_OWNER = 10;

/** How long a staff invitation stays open (rdm-spec B-13). */
export const STAFF_INVITE_TTL_DAYS = 7;

/** The `discovery_boost` weight one active boost slot writes (rdm-spec B-5). */
export const DISCOVERY_BOOST_WEIGHT = 50;

/** Upper bound of a voucher offer title (rdm-spec B-7, B-8). */
export const MAX_OFFER_TITLE_LENGTH = 120;

/** Upper bound of a voucher offer's description and terms (rdm-spec B-7, B-8). */
export const MAX_OFFER_TEXT_LENGTH = 1000;

/** Vouchers per order (rdm-spec B-9 CHECK). */
export const MAX_VOUCHERS_PER_ORDER = 10;

/** Upper bound of `plans.code` (rdm-spec B-1). */
export const MAX_PLAN_CODE_LENGTH = 32;

/** Upper bound of `plans.name` (rdm-spec B-1). */
export const MAX_PLAN_NAME_LENGTH = 64;

/** Upper bound of a Stripe object id we store (`price_…`, `cus_…`, `sub_…`, `evt_…`). */
export const MAX_STRIPE_ID_LENGTH = 255;

/** How long an owner's invoice list is cached (api-endpoints-plan §5.1). */
export const INVOICE_CACHE_TTL_MS = 5 * 60_000;
