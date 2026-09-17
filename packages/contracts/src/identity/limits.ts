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

/** Each action token's lifetime (rdm-spec I-9). */
export const ACTION_TOKEN_TTL_MS: Readonly<Record<ActionTokenPurpose, number>> = {
  [ActionTokenPurpose.PASSWORD_RESET]: HOUR_MS,
  [ActionTokenPurpose.EMAIL_VERIFICATION]: DAY_MS,
  [ActionTokenPurpose.EMAIL_CHANGE]: DAY_MS,
  [ActionTokenPurpose.EMAIL_CHANGE_REVERT]: EMAIL_CHANGE_REVERT_TTL_DAYS * DAY_MS,
};

/** The wait between an approved recovery and its link (rdm-spec I-14, api-endpoints-plan §1.10). */
export const RECOVERY_HOLD_HOURS = 72;

/** When an unfinished recovery expires (rdm-spec I-14). */
export const RECOVERY_EXPIRY_DAYS = 14;

/** An account's access token lifetime (product-overview §9, api-endpoints-plan §1.1). */
export const ACCOUNT_ACCESS_TOKEN_TTL_MS = 30 * MINUTE_MS;

/** A device's access token lifetime (product-overview §9, api-endpoints-plan §1.1). */
export const DEVICE_ACCESS_TOKEN_TTL_MS = 15 * MINUTE_MS;

/** A refresh token's lifetime (product-overview §9, api-endpoints-plan §1.1). */
export const REFRESH_TOKEN_TTL_MS = 7 * DAY_MS;
