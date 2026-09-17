const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * What a rate-limit bucket is keyed on. Each key is its own bucket, and a request must pass every
 * one of them (api-endpoints-plan §0.9).
 */
export type RateLimitKey =
  'ip' | 'email' | 'deviceId' | 'userId' | 'analyticsDeviceId' | 'billingAccountId';

/** One rate-limit class. */
export interface RateLimitSpec {
  readonly limit: number;
  readonly windowMs: number;
  readonly keys: readonly RateLimitKey[];
  /** Only failed attempts count; a success never uses the budget. */
  readonly countFailuresOnly?: true;
}

/** The rate-limit classes and their defaults (api-endpoints-plan §0.9). */
export const RATE_LIMITS = {
  PUBLIC_READ: { limit: 120, windowMs: MINUTE_MS, keys: ['ip'] },
  DEVICE_READ: { limit: 300, windowMs: MINUTE_MS, keys: ['deviceId'] },
  DEVICE_REGISTRATION: { limit: 10, windowMs: HOUR_MS, keys: ['ip'] },
  // Two buckets: rotating IPs against one address still hits the email bucket.
  AUTH: { limit: 10, windowMs: 15 * MINUTE_MS, keys: ['ip', 'email'] },
  NARRATION_ON_DEMAND: { limit: 30, windowMs: 10 * MINUTE_MS, keys: ['deviceId'] },
  ANALYTICS_INGEST: { limit: 60, windowMs: HOUR_MS, keys: ['analyticsDeviceId'] },
  // The burst limit only; the daily quota is the AI ledger's (rdm-spec X-2).
  AI_ENHANCEMENT: { limit: 20, windowMs: HOUR_MS, keys: ['userId'] },
  SHORT_CODE_PER_PERSON: {
    limit: 20,
    windowMs: 10 * MINUTE_MS,
    keys: ['userId'],
    countFailuresOnly: true,
  },
  SHORT_CODE_PER_SELLER: {
    limit: 20,
    windowMs: 10 * MINUTE_MS,
    keys: ['billingAccountId'],
    countFailuresOnly: true,
  },
  AUTHENTICATED: { limit: 600, windowMs: MINUTE_MS, keys: ['userId'] },
} as const satisfies Record<string, RateLimitSpec>;

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
