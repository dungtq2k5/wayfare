import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The locales that have their own bundles; every other locale falls back to `en`. */
export const BUNDLE_LOCALES = ['en', 'vi'] as const;

/** A locale with its own bundle. */
export type BundleLocale = (typeof BUNDLE_LOCALES)[number];

/** The namespaces this package ships. */
export type Namespace = 'email';

/**
 * `locales/`, beside `dist/` and `src/` in the package — read by path, never imported, so the JSON
 * ships through `files` and needs no copy step (like the contracts' `proto/`).
 */
export const LOCALES_ROOT = resolve(__dirname, '..', 'locales');

/** One namespace of one locale, parsed once per call site. */
export function readBundle(locale: BundleLocale, namespace: Namespace): unknown {
  return JSON.parse(readFileSync(join(LOCALES_ROOT, locale, `${namespace}.json`), 'utf8'));
}
