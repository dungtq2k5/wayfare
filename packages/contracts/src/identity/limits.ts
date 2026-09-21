import { ActionTokenPurpose } from './enums';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Upper bound of `devices.app_version` / `os_version` (rdm-spec I-2). */
export const MAX_VERSION_LENGTH = 32;

/** Upper bound of a legal document version string (rdm-spec I-12). */
export const MAX_POLICY_VERSION_LENGTH = 32;

/** How long a payout-affecting change blocks payout edits (rdm-spec I-1, ADR 0052). */
export const PAYOUT_CHANGE_COOLDOWN_DAYS = 7;

/** How long the old address may revert an email change (rdm-spec I-9, api-endpoints-plan §1.2). */
export const EMAIL_CHANGE_REVERT_TTL_DAYS = 7;

/** The wait between an approved recovery and its link (rdm-spec I-14, api-endpoints-plan §1.10). */
export const RECOVERY_HOLD_HOURS = 72;

/** When an unfinished recovery expires (rdm-spec I-14). */
export const RECOVERY_EXPIRY_DAYS = 14;

/** Upper bound of the support ticket a recovery names (rdm-spec I-14 `support_reference`). */
export const MAX_SUPPORT_REFERENCE_LENGTH = 64;

/** Each action token's lifetime (rdm-spec I-9). */
export const ACTION_TOKEN_TTL_MS: Readonly<Record<ActionTokenPurpose, number>> = {
  [ActionTokenPurpose.PASSWORD_RESET]: HOUR_MS,
  [ActionTokenPurpose.EMAIL_VERIFICATION]: DAY_MS,
  [ActionTokenPurpose.EMAIL_CHANGE]: DAY_MS,
  [ActionTokenPurpose.EMAIL_CHANGE_REVERT]: EMAIL_CHANGE_REVERT_TTL_DAYS * DAY_MS,
  // A welcome mail is often opened the next day.
  [ActionTokenPurpose.ACCOUNT_SETUP]: 72 * HOUR_MS,
  // The case's own `expires_at` is the real limit, and completion checks it; this is the outer
  // bound, long enough that a link never dies before the case it belongs to (rdm-spec I-14).
  [ActionTokenPurpose.ACCOUNT_RECOVERY]: RECOVERY_EXPIRY_DAYS * DAY_MS,
};

/** An account's access token lifetime (product-overview §9, api-endpoints-plan §1.1). */
export const ACCOUNT_ACCESS_TOKEN_TTL_MS = 30 * MINUTE_MS;

/** A device's access token lifetime (product-overview §9, api-endpoints-plan §1.1). */
export const DEVICE_ACCESS_TOKEN_TTL_MS = 15 * MINUTE_MS;

/** A refresh token's lifetime (product-overview §9, api-endpoints-plan §1.1). */
export const REFRESH_TOKEN_TTL_MS = 7 * DAY_MS;

/** Shortest accepted password (conventions §9.1). */
export const MIN_PASSWORD_LENGTH = 10;

/** Longest accepted password — bounds the argon2 input. */
export const MAX_PASSWORD_LENGTH = 128;

/** Upper bound of `users.full_name` (rdm-spec I-1). */
export const MAX_FULL_NAME_LENGTH = 120;

/** Upper bound of an email address — the RFC 5321 path limit (rdm-spec I-1). */
export const MAX_EMAIL_LENGTH = 254;

/** Upper bound of `devices.push_token` (rdm-spec I-2). */
export const MAX_PUSH_TOKEN_LENGTH = 255;

/** Upper bound of a presented refresh token — a generated one is 43 characters. */
export const MAX_REFRESH_TOKEN_LENGTH = 256;

/** How long a just-rotated cookie session's token is a lost race rather than a replay (rdm-spec I-3). */
export const REFRESH_RACE_GRACE_MS = 10_000;

/** `devices.last_seen_at` is bumped at most this often (rdm-spec I-2). */
export const DEVICE_LAST_SEEN_THROTTLE_MS = HOUR_MS;

/** Most session families one `identity.session.revoked` event lists; a larger set is split. */
export const MAX_FAMILIES_PER_EVENT = 100;

/** The `typ` claim of an access token (api-endpoints-plan §0.1). */
export const TOKEN_TYPES = { device: 'device', user: 'user' } as const;
/** An access token's type. */
export type TokenType = (typeof TOKEN_TYPES)[keyof typeof TOKEN_TYPES];

/** Upper bound of a lock's reason — it is stored in `users.lock_reason` (rdm-spec I-1). */
export const MAX_LOCK_REASON_LENGTH = 255;

/** Upper bound of an admin action's reason kept only in the audit row (rdm-spec I-11). */
export const MAX_ADMIN_REASON_LENGTH = 500;

/** Upper bound of `roles.name` (rdm-spec I-4). */
export const MAX_ROLE_NAME_LENGTH = 80;

/** Upper bound of `roles.description` (rdm-spec I-4). */
export const MAX_ROLE_DESCRIPTION_LENGTH = 255;

/** Upper bound of `roles.code` (rdm-spec I-4). */
export const MAX_ROLE_CODE_LENGTH = 32;

/** Most roles one account may hold. */
export const MAX_ROLES_PER_USER = 20;

/** Most live holders a role-permission change may touch (rdm-spec I-4). */
export const MAX_ROLE_HOLDERS_PER_CHANGE = 500;

/** Upper bound of an audit action filter (rdm-spec I-11 `action`). */
export const MAX_AUDIT_ACTION_LENGTH = 64;

/** How far ahead a lock may expire. */
export const MAX_LOCK_DURATION_MS = 366 * DAY_MS;

/** Upper bound of `owner_registrations.business_name` (rdm-spec I-8). */
export const MAX_BUSINESS_NAME_LENGTH = 160;

/** Upper bound of `owner_registrations.business_address` (rdm-spec I-8). */
export const MAX_BUSINESS_ADDRESS_LENGTH = 255;

/** Upper bound of `owner_registrations.business_registration_no` (rdm-spec I-8). */
export const MAX_BUSINESS_REGISTRATION_NO_LENGTH = 32;

/** Upper bound of `owner_registrations.contact_name` (rdm-spec I-8). */
export const MAX_CONTACT_NAME_LENGTH = 120;

/** Upper bound of an applicant's or a reviewer's staff-only note on an owner registration. */
export const MAX_REGISTRATION_NOTE_LENGTH = 2000;
