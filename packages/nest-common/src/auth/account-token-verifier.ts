import type { KeyObject } from 'node:crypto';
import { TOKEN_TYPES, zAccountClaims, zDeviceClaims } from '@wayfare/contracts';
import type { AccountClaims, DeviceClaims } from '@wayfare/contracts';
import { verifyJws } from './jws';
import {
  CUTOFF_REJECT_ALL,
  raiseTokenCutoff,
  revokedFamilyKey,
  tokenCutoffKey,
} from './redis-keys';
import type { RedisScripting } from './redis-keys';

/** Where a user's token cutoff is read when Redis has none (api-endpoints-plan §12.2). */
export interface TokenCutoffSource {
  /** The user's cutoff in ms (0 = none), or 'not-found'. Throws when identity cannot answer. */
  getCutoff(userId: string): Promise<number | 'not-found'>;
}

/** The Redis surface the revocation check needs — satisfied by an ioredis client. */
export interface RevocationStore extends RedisScripting {
  mget(...keys: string[]): Promise<(string | null)[]>;
}

/** What the verifier is built from. */
export interface AccountTokenVerifierDeps {
  readonly publicKeys: ReadonlyMap<string, KeyObject>;
  readonly redis: RevocationStore;
  readonly cutoffSource: TokenCutoffSource;
  /** The miss-fill deadline — 500 ms in production. */
  readonly cutoffTimeoutMs?: number;
  readonly now?: () => Date;
}

/** The deadline for a cutoff read on a cache miss. */
export const CUTOFF_LOOKUP_TIMEOUT_MS = 500;

/** A token that verified, classified by its `typ`. */
export type VerifiedToken =
  | { readonly type: 'account'; readonly claims: AccountClaims }
  | { readonly type: 'device'; readonly claims: DeviceClaims }
  | null;

/** The revocation check's answer: never a pass when it cannot answer (api-endpoints-plan §0.1). */
export type AccountTokenCheck =
  | { readonly kind: 'valid'; readonly claims: AccountClaims }
  | { readonly kind: 'rejected'; readonly error: 'revoked' | 'unverifiable' };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * The account-token checks every entry point shares (api-endpoints-plan §0.1): the HTTP middleware,
 * the socket handshake and the socket's revalidation.
 *
 * - `verify` — signature, audience, expiry, and the claims' shape;
 * - `check` — the user's cutoff and the signed-out family in Redis; a cutoff miss is filled from
 *   identity through the raise-only script; if either cannot answer, `unverifiable`;
 * - `checkMany` — the same for many tokens with one `MGET`, identity asked only for the misses.
 */
export class AccountTokenVerifier {
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(private readonly deps: AccountTokenVerifierDeps) {
    this.now = deps.now ?? (() => new Date());
    this.timeoutMs = deps.cutoffTimeoutMs ?? CUTOFF_LOOKUP_TIMEOUT_MS;
  }

  verify(token: string): VerifiedToken {
    const result = verifyJws(token, { publicKeys: this.deps.publicKeys, now: this.now() });
    if (!result.ok) return null;
    if (result.claims.typ === TOKEN_TYPES.user) {
      const claims = zAccountClaims.safeParse(result.claims);
      return claims.success ? { type: 'account', claims: claims.data } : null;
    }
    if (result.claims.typ === TOKEN_TYPES.device) {
      const claims = zDeviceClaims.safeParse(result.claims);
      return claims.success ? { type: 'device', claims: claims.data } : null;
    }
    return null;
  }

  async check(claims: AccountClaims): Promise<AccountTokenCheck> {
    const [result] = await this.checkMany([claims]);
    return result!;
  }

  async checkMany(all: readonly AccountClaims[]): Promise<AccountTokenCheck[]> {
    if (all.length === 0) return [];
    let stored: (string | null)[];
    try {
      stored = await this.deps.redis.mget(
        ...all.flatMap((claims) => [tokenCutoffKey(claims.sub), revokedFamilyKey(claims.sid)]),
      );
    } catch {
      return all.map(() => ({ kind: 'rejected', error: 'unverifiable' }));
    }
    // One identity read per user whose cutoff Redis does not hold.
    const fills = new Map<string, Promise<number>>();
    for (const [index, claims] of all.entries()) {
      const cutoff = stored[index * 2];
      if ((cutoff === null || cutoff === undefined) && !fills.has(claims.sub)) {
        fills.set(claims.sub, this.fill(claims.sub));
      }
    }
    return Promise.all(
      all.map(async (claims, index): Promise<AccountTokenCheck> => {
        try {
          const storedCutoff = stored[index * 2];
          const family = stored[index * 2 + 1];
          const cutoff =
            storedCutoff === null || storedCutoff === undefined
              ? await fills.get(claims.sub)!
              : Number(storedCutoff);
          const revoked = claims.iatMs < cutoff || (family !== null && family !== undefined);
          return revoked ? { kind: 'rejected', error: 'revoked' } : { kind: 'valid', claims };
        } catch {
          return { kind: 'rejected', error: 'unverifiable' };
        }
      }),
    );
  }

  /** A cutoff from identity, written through the raise-only script (never lowering one). */
  private async fill(userId: string): Promise<number> {
    const answer = await withTimeout(this.deps.cutoffSource.getCutoff(userId), this.timeoutMs);
    return raiseTokenCutoff(
      this.deps.redis,
      userId,
      answer === 'not-found' ? CUTOFF_REJECT_ALL : answer,
    );
  }
}
