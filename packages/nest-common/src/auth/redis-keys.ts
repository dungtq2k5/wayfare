import { ACCOUNT_ACCESS_TOKEN_TTL_MS } from '@wayfare/contracts';

/**
 * Revocation state in Redis (api-endpoints-plan §0.1, architecture §3.5). identity writes it from
 * `identity.session.revoked`; the gateway reads it on every account request and fills a miss.
 * Nothing here is the only record: a lost key costs a database read or one token lifetime.
 */

/** The user's token cutoff, milliseconds since the epoch. */
export function tokenCutoffKey(userId: string): string {
  return `identity:token-cutoff:${userId}`;
}

/** A signed-out session family. */
export function revokedFamilyKey(familyId: string): string {
  return `identity:revoked-family:${familyId}`;
}

/** A cutoff that rejects every token and can never be lowered — an unknown or erased user. */
export const CUTOFF_REJECT_ALL = Number.MAX_SAFE_INTEGER;

/**
 * A cutoff key lives one access-token lifetime plus skew: every token issued before the cutoff has
 * expired by then, and a later miss re-reads the database.
 */
export const TOKEN_CUTOFF_TTL_MS = ACCOUNT_ACCESS_TOKEN_TTL_MS + 60_000;

/** A family marker lives one access-token lifetime — no token of the family can outlive it. */
export const REVOKED_FAMILY_TTL_MS = ACCOUNT_ACCESS_TOKEN_TTL_MS;

/**
 * Raise-only write: sets `KEYS[1]` to `ARGV[1]` only when the key is absent or holds a lower
 * number, then refreshes its TTL (`ARGV[2]` ms). Both writers — identity's consumer and the
 * gateway's miss-fill — use it, so a stale fill can never lower a newer cutoff. Returns the value
 * the key holds afterwards.
 */
export const RAISE_ONLY_SCRIPT = `
local current = redis.call('GET', KEYS[1])
local wanted = tonumber(ARGV[1])
if current == false or tonumber(current) < wanted then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return ARGV[1]
end
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return current
`;

/** The minimal Redis surface the scripts need — satisfied by an ioredis client. */
export interface RedisScripting {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

/** Runs the raise-only script; resolves to the value the key holds afterwards. */
export async function raiseTokenCutoff(
  redis: RedisScripting,
  userId: string,
  cutoffMs: number,
  ttlMs: number = TOKEN_CUTOFF_TTL_MS,
): Promise<number> {
  const result = await redis.eval(
    RAISE_ONLY_SCRIPT,
    1,
    tokenCutoffKey(userId),
    String(cutoffMs),
    String(ttlMs),
  );
  return Number(result);
}
