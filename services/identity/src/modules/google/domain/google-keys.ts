import { createPublicKey } from 'node:crypto';
import type { JsonWebKey, KeyObject } from 'node:crypto';
import { FAKE_GOOGLE_KEY_ID } from './id-token';

/** Google's published ID-token keys. */
export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/**
 * Where the verifier finds the key an ID token names (ADR 0062), or the fake's (ADR 0063): the key,
 * undefined for an id the issuer does not publish, or `unavailable` when Google cannot be asked —
 * `GOOGLE_UNAVAILABLE`, never counted as a failed sign-in.
 */
export interface GoogleKeys {
  key(keyId: string): Promise<KeyObject | undefined | 'unavailable'>;
}

/** Without a `max-age`, keys are kept an hour. */
const DEFAULT_MAX_AGE_MS = 3_600_000;
/** An unknown key id refetches at most this often: Google rotates its keys, a forger does not. */
const REFETCH_MS = 60_000;

/** Google's keys, cached as long as `Cache-Control` says. */
export function publishedGoogleKeys(
  fetchKeys: typeof fetch = fetch,
  clock: () => number = Date.now,
): GoogleKeys {
  let keys = new Map<string, KeyObject>();
  let freshUntil = 0;
  let fetchedAt = 0;

  const refresh = async (now: number): Promise<boolean> => {
    let response: Response;
    try {
      response = await fetchKeys(GOOGLE_CERTS_URL, { signal: AbortSignal.timeout(5_000) });
    } catch {
      return false;
    }
    if (!response.ok) return false;
    const body = (await response.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
    const next = new Map<string, KeyObject>();
    for (const jwk of body.keys ?? []) {
      if (typeof jwk.kid === 'string')
        next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
    }
    const maxAge = /max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1];
    keys = next;
    fetchedAt = now;
    freshUntil = now + (maxAge === undefined ? DEFAULT_MAX_AGE_MS : Number(maxAge) * 1000);
    return true;
  };

  return {
    async key(keyId) {
      const now = clock();
      const stale = now >= freshUntil;
      if (stale || (!keys.has(keyId) && now - fetchedAt >= REFETCH_MS)) {
        // A failed refetch of keys still fresh keeps them; with none fresh, Google is unreachable.
        if (!(await refresh(now)) && stale) return 'unavailable';
      }
      return keys.get(keyId);
    },
  };
}

/** The fake issuer's one key, from identity's own signing key for it (development only). */
export function fakeGoogleKeys(privateKey: KeyObject): GoogleKeys {
  const publicKey = createPublicKey(privateKey);
  return {
    key: (keyId) => Promise.resolve(keyId === FAKE_GOOGLE_KEY_ID ? publicKey : undefined),
  };
}
