import { isIPv4, isIPv6 } from 'node:net';
import { hashToken } from '../crypto/tokens';
import type { RedisScripting } from '../auth/redis-keys';
import { bucketsFor, RATE_LIMITS } from '@wayfare/contracts';
import type { RateLimitClass, RateLimitKey } from '@wayfare/contracts';

/**
 * Every bucket of one request, atomically (api-endpoints-plan §0.9): if any is at its limit, nothing
 * is counted and the longest remaining window comes back; otherwise each is counted, its fixed
 * window starting on its first hit. A refused request costs no bucket anything, so one caller stuck
 * at its own limit cannot fill a bucket it shares — a network's — for everyone else.
 * KEYS: the buckets. ARGV[1]: the window in ms; ARGV[1 + i]: KEYS[i]'s limit. Returns 0, or the
 * wait in ms.
 */
export const RATE_LIMIT_SCRIPT = `
local wait = 0
for i, key in ipairs(KEYS) do
  local count = tonumber(redis.call('GET', key) or '0')
  if count >= tonumber(ARGV[i + 1]) then
    local ttl = redis.call('PTTL', key)
    if ttl < 0 then redis.call('PEXPIRE', key, ARGV[1]); ttl = tonumber(ARGV[1]) end
    if ttl > wait then wait = ttl end
  end
end
if wait > 0 then return wait end
for _, key in ipairs(KEYS) do
  if redis.call('INCR', key) == 1 then redis.call('PEXPIRE', key, ARGV[1]) end
  if redis.call('PTTL', key) < 0 then redis.call('PEXPIRE', key, ARGV[1]) end
end
return 0
`;

/** Takes back what one request counted (a sign-in that did not fail); a spent key stays spent. */
export const RATE_LIMIT_REFUND_SCRIPT = `
for _, key in ipairs(KEYS) do
  if redis.call('EXISTS', key) == 1 and redis.call('DECR', key) <= 0 then redis.call('DEL', key) end
end
return 0
`;

/** The outcome of counting one request; `counted` names what a refund would take back. */
export type RateLimitVerdict =
  | { readonly allowed: true; readonly counted: readonly string[] }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

/**
 * The IP a bucket counts: an IPv4 address whole — also when the dual-stack socket reports it as
 * `::ffff:a.b.c.d`, or every IPv4 caller would share one `/64` — and an IPv6 address by its `/64`,
 * the unit one subscriber receives, so rotating addresses inside it gains nothing.
 */
export function rateLimitIp(ip: string): string {
  const address = ip.split('%')[0]!;
  if (isIPv4(address) || !isIPv6(address)) return address;
  const groups = ipv6Groups(address);
  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (mapped) {
    const [high, low] = [groups[6]!, groups[7]!];
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`;
}

/** An IPv6 address's eight groups, `::` and a trailing dotted IPv4 part expanded. */
function ipv6Groups(address: string): number[] {
  const [head = '', tail] = address.split('::') as [string, string | undefined];
  const parse = (part: string) =>
    part === ''
      ? []
      : part.split(':').flatMap((group) => {
          if (!group.includes('.')) return [parseInt(group, 16)];
          const [a, b, c, d] = group.split('.').map(Number) as [number, number, number, number];
          return [(a << 8) | b, (c << 8) | d];
        });
  const front = parse(head);
  const back = tail === undefined ? [] : parse(tail);
  return [...front, ...new Array<number>(8 - front.length - back.length).fill(0), ...back];
}

/** A bucket's Redis key. An email is hashed, so the key space holds no addresses. */
export function rateLimitKey(cls: RateLimitClass, key: RateLimitKey, value: string): string {
  const keyed = key === 'email' ? hashToken(value) : key === 'ip' ? rateLimitIp(value) : value;
  return `rl:${cls}:${key}:${keyed}`;
}

/**
 * Counts a request against the buckets of its class that apply to it — the device ones when it
 * carries a verified device id, the others when it does not — all or nothing. Buckets with no value
 * (no email in the body) are skipped. Store errors propagate; the guard decides.
 */
export class RateLimiter {
  constructor(private readonly redis: RedisScripting) {}

  async hit(
    cls: RateLimitClass,
    values: Partial<Record<RateLimitKey, string>>,
  ): Promise<RateLimitVerdict> {
    const spec = RATE_LIMITS[cls];
    const keys: string[] = [];
    const limits: number[] = [];
    for (const bucket of bucketsFor(spec, values.deviceId !== undefined)) {
      const value = values[bucket.key];
      if (value === undefined || value === '') continue;
      keys.push(rateLimitKey(cls, bucket.key, value));
      limits.push(bucket.limit);
    }
    if (keys.length === 0) return { allowed: true, counted: [] };
    const waitMs = Number(
      await this.redis.eval(RATE_LIMIT_SCRIPT, keys.length, ...keys, spec.windowMs, ...limits),
    );
    return waitMs > 0
      ? { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) }
      : { allowed: true, counted: keys };
  }

  /** Takes back a request's count (`countFailuresOnly`: it did not fail). */
  async refund(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.redis.eval(RATE_LIMIT_REFUND_SCRIPT, keys.length, ...keys);
  }
}
