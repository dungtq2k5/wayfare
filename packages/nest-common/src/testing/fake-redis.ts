import type { RevocationStore } from '../auth/account-token-verifier';

/**
 * An in-memory stand-in for the two Redis scripts, `MGET`, `GET`, `SET` and `DEL` — the semantics
 * the specs rely on, not a Redis. The real scripts run against Redis in identity's integration suite
 * and the gateway's e2e suite.
 */
export class FakeRedis implements RevocationStore {
  readonly values = new Map<string, string>();
  /** When set, every command rejects with it — a Redis outage. */
  failure: Error | null = null;

  mget(...keys: string[]): Promise<(string | null)[]> {
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(keys.map((key) => this.values.get(key) ?? null));
  }

  get(key: string): Promise<string | null> {
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(this.values.get(key) ?? null);
  }

  /** `SET key value [PX ms] [NX]` — expiry is not simulated; `NX` refuses an existing key. */
  set(key: string, value: string, ...options: (string | number)[]): Promise<'OK' | null> {
    if (this.failure) return Promise.reject(this.failure);
    if (options.includes('NX') && this.values.has(key)) return Promise.resolve(null);
    this.values.set(key, value);
    return Promise.resolve('OK');
  }

  del(...keys: string[]): Promise<number> {
    if (this.failure) return Promise.reject(this.failure);
    let removed = 0;
    for (const key of keys) if (this.values.delete(key)) removed++;
    return Promise.resolve(removed);
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
