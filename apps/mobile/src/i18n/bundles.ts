/** A UI bundle as `GET /i18n/bundles/:namespace/:locale` answers it. */
export interface UiBundle {
  readonly status: 'READY' | 'PENDING';
  readonly sourceHash: string;
  readonly messages: Readonly<Record<string, string>>;
  readonly retryAfterMs: number | null;
}

/** A READY bundle kept on the phone. */
export interface CachedBundle {
  readonly sourceHash: string;
  readonly messages: Readonly<Record<string, string>>;
}

export interface BundleLoaderDeps {
  fetchBundle(locale: string, sourceHash: string | undefined): Promise<UiBundle>;
  readCache(locale: string): Promise<CachedBundle | null>;
  writeCache(locale: string, bundle: CachedBundle): Promise<void>;
  /** Puts messages into the running i18n instance. */
  apply(locale: string, messages: Readonly<Record<string, string>>): void;
  wait(ms: number): Promise<void>;
  /** Stops waiting for a translation once the language is no longer the one on screen. */
  isCurrent?(locale: string): boolean;
}

/** How long to wait when `PENDING` says nothing, and how many times to ask. */
export const DEFAULT_RETRY_MS = 5_000;
export const MAX_ATTEMPTS = 12;

export type BundleOutcome = 'ready' | 'pending' | 'offline';

/**
 * Brings one locale's UI strings in: the cached bundle at once, then the server's. A `PENDING`
 * answer carries English, which is not applied — the screen already shows English — and is asked
 * again after `retryAfterMs`. Offline keeps whatever the cache gave.
 */
export async function loadBundle(locale: string, deps: BundleLoaderDeps): Promise<BundleOutcome> {
  const cached = await deps.readCache(locale);
  if (cached !== null) deps.apply(locale, cached.messages);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (deps.isCurrent?.(locale) === false) return 'pending';
    let bundle: UiBundle;
    try {
      bundle = await deps.fetchBundle(locale, cached?.sourceHash);
    } catch {
      return 'offline';
    }
    if (bundle.status === 'READY') {
      deps.apply(locale, bundle.messages);
      await deps.writeCache(locale, { sourceHash: bundle.sourceHash, messages: bundle.messages });
      return 'ready';
    }
    await deps.wait(bundle.retryAfterMs ?? DEFAULT_RETRY_MS);
  }
  return 'pending';
}
