import type { RevocationStore } from '../auth/account-token-verifier';

/**
 * An in-memory stand-in for the two Redis scripts and `MGET` — the semantics the specs rely on,
 * not a Redis. The real scripts run against Redis in identity's integration suite and the gateway's
 * e2e suite.
 */
export class FakeRedis implements RevocationStore {
  readonly values = new Map<string, string>();
  /** When set, every command rejects with it — a Redis outage. */
  failure: Error | null = null;

  mget(...keys: string[]): Promise<(string | null)[]> {
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(keys.map((key) => this.values.get(key) ?? null));
  }

  eval(script: string, _numKeys: number, ...args: (string | number)[]): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    const [key, first] = args.map(String) as [string, string];
    if (script.includes('INCR')) {
      const count = Number(this.values.get(key) ?? '0') + 1;
      this.values.set(key, String(count));
      return Promise.resolve([count, Number(first)]);
    }
    const current = this.values.get(key);
    if (current === undefined || Number(current) < Number(first)) {
      this.values.set(key, first);
      return Promise.resolve(first);
    }
    return Promise.resolve(current);
  }
}
