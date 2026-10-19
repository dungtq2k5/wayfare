const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** What a rate-limit bucket is keyed on (api-endpoints-plan §0.9). */
export type RateLimitKey =
  'ip' | 'email' | 'deviceId' | 'userId' | 'analyticsDeviceId' | 'billingAccountId';

/** One counter of a class: its key, its own limit, and which callers it applies to. */
export interface RateLimitBucket {
  readonly key: RateLimitKey;
  readonly limit: number;
  /**
   * Only for a caller with a verified device token (`device`), or only for one without
   * (`noDevice`); always when absent.
   */
  readonly onlyWith?: 'device' | 'noDevice';
}

/** One rate-limit class: a window, and the buckets a request must all pass within it. */
export interface RateLimitSpec {
  readonly windowMs: number;
  readonly buckets: readonly RateLimitBucket[];
  /**
   * Only failed attempts count: each attempt is counted up front, so parallel ones cannot all slip
   * past, and refunded when it does not fail.
   */
  readonly countFailuresOnly?: true;
}

/** A class with one bucket: the shape of every class keyed on one thing. */
const one = (key: RateLimitKey, limit: number, windowMs: number) =>
  ({ windowMs, buckets: [{ key, limit }] }) as const;

/**
 * Sign-in's buckets: the account's (its only defence — identity has no automatic lockout), the
 * install's, and the network's — 10 without a device token (the console, a script), a ceiling of 30
 * with one, so a hotel's guests are not refused for each other's tries.
 */
const SIGN_IN_BUCKETS = [
  { key: 'email', limit: 10 },
  { key: 'deviceId', limit: 10, onlyWith: 'device' },
  { key: 'ip', limit: 10, onlyWith: 'noDevice' },
  { key: 'ip', limit: 30, onlyWith: 'device' },
] as const satisfies readonly RateLimitBucket[];

/** The rate-limit classes and their defaults (api-endpoints-plan §0.9). */
export const RATE_LIMITS = {
  PUBLIC_READ: one('ip', 120, MINUTE_MS),
  DEVICE_READ: one('deviceId', 300, MINUTE_MS),
  // A busy hotel's installs in an hour; each install's sign-ins then meet the ceiling above.
  DEVICE_REGISTRATION: one('ip', 60, HOUR_MS),
  // Register, forgot password, account recovery: each call creates or sends something, so all count.
  AUTH: { windowMs: 15 * MINUTE_MS, buckets: SIGN_IN_BUCKETS },
  // Sign-in: a success proves the password, so only wrong ones spend the budget.
  AUTH_LOGIN: { windowMs: 15 * MINUTE_MS, buckets: SIGN_IN_BUCKETS, countFailuresOnly: true },
  NARRATION_ON_DEMAND: one('deviceId', 30, 10 * MINUTE_MS),
  ANALYTICS_INGEST: one('analyticsDeviceId', 60, HOUR_MS),
  // The burst limit only; the daily quota is the AI ledger's (rdm-spec X-2).
  AI_ENHANCEMENT: one('userId', 20, HOUR_MS),
  SHORT_CODE_PER_PERSON: { ...one('userId', 20, 10 * MINUTE_MS), countFailuresOnly: true },
  SHORT_CODE_PER_SELLER: {
    ...one('billingAccountId', 20, 10 * MINUTE_MS),
    countFailuresOnly: true,
  },
  // A signed-in person's current-password checks (PATCH /auth/password, POST /auth/email/change).
  PASSWORD_CHECK: one('userId', 10, 15 * MINUTE_MS),
  EMAIL_REQUEST: one('userId', 5, HOUR_MS),
  // Each delivery check is a guess against the keyed hash; bounded per staff member.
  EMAIL_CHECK: one('userId', 30, HOUR_MS),
  // National ID reveals, on top of each one's audit row: bounds what one staff session can read.
  PII_REVEAL: one('userId', 20, HOUR_MS),
  // "Does it sound right now?" before saving an entry: each one is a speech call (§4.4).
  PRONUNCIATION_PREVIEW: one('userId', 10, MINUTE_MS),
  AUTHENTICATED: one('userId', 600, MINUTE_MS),
} as const satisfies Record<string, RateLimitSpec>;

/** The buckets that apply to a request, by whether it carries a verified device token. */
export function bucketsFor(spec: RateLimitSpec, withDevice: boolean): readonly RateLimitBucket[] {
  return spec.buckets.filter(
    (bucket) => bucket.onlyWith === undefined || (bucket.onlyWith === 'device') === withDevice,
  );
}

/** A rate-limit class name. */
export type RateLimitClass = keyof typeof RATE_LIMITS;

/** A page's size when the request names none (api-endpoints-plan §0.5). */
export const PAGE_SIZE_DEFAULT = 20;

/** The largest page a request may ask for (api-endpoints-plan §0.5). */
export const PAGE_SIZE_MAX = 100;

/** How long an idempotency key's response is replayed (api-endpoints-plan §0.8). */
export const IDEMPOTENCY_TTL_MS = 24 * HOUR_MS;

/** The widest audit-log query window, in days (api-endpoints-plan §1.8). */
export const AUDIT_QUERY_MAX_DAYS = 93;
