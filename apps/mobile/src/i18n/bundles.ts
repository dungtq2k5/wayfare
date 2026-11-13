import { ApiError, NETWORK_ERROR_CODE } from '@wayfare/api-client';

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
  /**
   * Stops waiting for a translation once nobody wants the language any more: neither the one on
   * screen nor the one a switch is under way to.
   */
  isWanted?(locale: string): boolean;
  /** Told of each `PENDING` answer: a switch shows the words as being translated meanwhile. */
  onPending?(locale: string): void;
}

/** How long to wait when `PENDING` says nothing, and how many times to ask. */
export const DEFAULT_RETRY_MS = 5_000;
export const MAX_ATTEMPTS = 12;

/** `offline`: no answer from the server; `failed`: the server answered with an error. */
export type BundleOutcome = 'ready' | 'pending' | 'offline' | 'failed';

/**
 * Brings one locale's UI strings in: the cached bundle at once, then the server's. A `PENDING`
 * answer carries English, which is not applied — the screen already shows English — and is asked
 * again after `retryAfterMs`. Offline, or a server error, keeps whatever the cache gave.
 */
export async function loadBundle(locale: string, deps: BundleLoaderDeps): Promise<BundleOutcome> {
  const cached = await deps.readCache(locale);
  if (cached !== null) deps.apply(locale, cached.messages);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (deps.isWanted?.(locale) === false) return 'pending';
    let bundle: UiBundle;
    try {
      bundle = await deps.fetchBundle(locale, cached?.sourceHash);
    } catch (error) {
      return error instanceof ApiError && error.code !== NETWORK_ERROR_CODE ? 'failed' : 'offline';
    }
    if (bundle.status === 'READY') {
      deps.apply(locale, bundle.messages);
      await deps.writeCache(locale, { sourceHash: bundle.sourceHash, messages: bundle.messages });
      return 'ready';
    }
    deps.onPending?.(locale);
    await deps.wait(bundle.retryAfterMs ?? DEFAULT_RETRY_MS);
  }
  return 'pending';
}
