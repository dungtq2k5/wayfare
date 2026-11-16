// Retention periods — one constant per period in rdm-spec §7. The "indefinitely" rows (account
// recoveries, financial records) deliberately have none: a constant would invite a pruning job.
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** How long an event stream keeps messages (api-endpoints-plan §10). */
export const EVENT_STREAM_MAX_AGE_MS = 7 * DAY_MS;

/** How long the dead-letter stream keeps messages — longer, since they exist to be inspected. */
export const DLQ_MAX_AGE_MS = 30 * DAY_MS;

/** Anonymous devices, since last seen (rdm-spec §7). */
export const DEVICE_RETENTION_DAYS = 400;
/** Expired sessions, past expiry (rdm-spec §7). */
export const SESSION_RETENTION_AFTER_EXPIRY_DAYS = 30;
/** Action tokens, past expiry (rdm-spec §7). */
export const ACTION_TOKEN_RETENTION_AFTER_EXPIRY_DAYS = 7;
/** National ID ciphertext, after review (rdm-spec §7, product-overview §9). */
export const PII_RETENTION_DAYS = 180;
/** Notifications — `expires_at` (rdm-spec §7). */
export const NOTIFICATION_RETENTION_DAYS = 90;
/** Audit logs (rdm-spec §7). */
export const AUDIT_RETENTION_DAYS = 730;
/** Synthesis jobs, after finishing (rdm-spec §7, product-overview §9). */
export const JOB_RETENTION_DAYS = 14;
/** Unreferenced audio assets, since last referenced (rdm-spec §7). */
export const AUDIO_ASSET_RETENTION_DAYS = 180;
/** Translation cache, since last used (rdm-spec §7). */
export const TRANSLATION_CACHE_RETENTION_DAYS = 365;
/** Pending uploads left unconfirmed — the signed URL's lifetime (rdm-spec §7, C-12). */
export const PENDING_UPLOAD_CONFIRM_TTL_MS = 15 * MINUTE_MS;
/** Pending uploads confirmed but never consumed (rdm-spec §7, C-12). */
export const PENDING_UPLOAD_TTL_DAYS = 14;
/** Retired map pack objects (rdm-spec §7). */
export const MAP_PACK_RETENTION_DAYS = 30;
/** Stripe webhook events (rdm-spec §7). */
export const BILLING_EVENT_RETENTION_DAYS = 400;
/** Email delivery records (rdm-spec §7). */
export const EMAIL_DELIVERY_RETENTION_DAYS = 400;
/** Expired or revoked staff invitations (rdm-spec §7). */
export const STAFF_INVITE_RETENTION_DAYS = 90;
/** Superseded or reverted translation corrections (rdm-spec §7). */
export const LOCALIZATION_OVERRIDE_RETENTION_DAYS = 400;
/** Raw analytics events (rdm-spec §7). */
export const RAW_EVENT_RETENTION_DAYS = 90;
/** Consent history, after the last decision (rdm-spec §7). */
export const CONSENT_RETENTION_DAYS = 400;
/** AI ledger (rdm-spec §7). */
export const AI_LEDGER_RETENTION_DAYS = 400;
/** Outbox rows, after publishing (rdm-spec §7). */
export const OUTBOX_RETENTION_DAYS = 7;
/** Processed-event records — the stream's `max_age` plus a day (rdm-spec §7). */
export const PROCESSED_EVENT_RETENTION_MS = EVENT_STREAM_MAX_AGE_MS + DAY_MS;

/** How often an analytics device id rotates (ADR 0042). Not an rdm-spec §7 row; kept beside them. */
export const ANALYTICS_ID_ROTATION_DAYS = 30;
