import { hashToken } from '../crypto/tokens';
import type { RedisScripting } from '../auth/redis-keys';
import { RATE_LIMITS } from '@wayfare/contracts';
import type { RateLimitClass, RateLimitKey } from '@wayfare/contracts';

/**
 * One fixed window per bucket, atomically: count, start the window on the first hit, and report the
 * remaining window (api-endpoints-plan §0.9). A key that lost its expiry gets it back.
 */
export const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return { count, ttl }
`;

/** The outcome of counting one request. */
export type RateLimitVerdict =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

/** A bucket's Redis key. An email is hashed, so the key space holds no addresses. */
export function rateLimitKey(cls: RateLimitClass, key: RateLimitKey, value: string): string {
  return `rl:${cls}:${key}:${key === 'email' ? hashToken(value) : value}`;
}

/**
 * Counts a request against every bucket of its class — each key its own bucket, all must pass.
 * Keys with no value (no email in the body) are skipped. Store errors propagate; the guard decides.
 */
export class RateLimiter {
  constructor(private readonly redis: RedisScripting) {}

  async hit(
    cls: RateLimitClass,
    values: Partial<Record<RateLimitKey, string>>,
  ): Promise<RateLimitVerdict> {
    const spec = RATE_LIMITS[cls];
    let retryAfterMs = 0;
    for (const key of spec.keys) {
      const value = values[key];
      if (value === undefined || value === '') continue;
      const result = (await this.redis.eval(
        RATE_LIMIT_SCRIPT,
        1,
        rateLimitKey(cls, key, value),
        String(spec.windowMs),
      )) as [number, number];
      const [count, ttlMs] = result;
      if (count > spec.limit) retryAfterMs = Math.max(retryAfterMs, ttlMs);
    }
    return retryAfterMs > 0
      ? { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) }
      : { allowed: true };
  }
}
