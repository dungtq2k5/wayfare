import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The locales that have their own bundles; every other locale falls back to `en`. */
export const BUNDLE_LOCALES = ['en', 'vi'] as const;

/** A locale with its own bundle. */
export type BundleLocale = (typeof BUNDLE_LOCALES)[number];

/** The namespaces this package ships: the server's email templates and the two apps' UI strings. */
export const NAMESPACES = ['email', 'tourist', 'console'] as const;

/** One namespace of messages. */
export type Namespace = (typeof NAMESPACES)[number];

/** The app namespaces a UI bundle serves (rdm-spec N-6) — `email` is rendered here, never served. */
export const UI_NAMESPACES = ['tourist', 'console'] as const;

/**
 * `locales/`, beside `dist/` and `src/` in the package — read by path, never imported, so the JSON
 * ships through `files` and needs no copy step (like the contracts' `proto/`).
 */
export const LOCALES_ROOT = resolve(__dirname, '..', 'locales');

/** One namespace of one locale, parsed once per call site. */
export function readBundle(locale: BundleLocale, namespace: Namespace): unknown {
  return JSON.parse(readFileSync(join(LOCALES_ROOT, locale, `${namespace}.json`), 'utf8'));
}

/**
 * A UI namespace as a flat `{ key: ICU string }` map (rdm-spec N-6). The apps' bundles are flat by
 * construction; a nested one would be a mistake in the file, so it is refused here rather than
 * stored half-read.
 */
export function readUiBundle(
  locale: BundleLocale,
  namespace: (typeof UI_NAMESPACES)[number],
): Record<string, string> {
  const parsed = readBundle(locale, namespace) as Record<string, unknown>;
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new Error(`${locale}/${namespace}.json: ${key} is not a string — UI bundles are flat`);
    }
    flat[key] = value;
  }
  return flat;
}

/**
 * The version of a namespace's **English** source (rdm-spec N-6 `source_hash`): the SHA-256 of its
 * keys and strings in key order, so the same content always hashes the same however the file is
 * formatted, and any edit gives every locale a new version to translate.
 */
export function bundleSourceHash(namespace: (typeof UI_NAMESPACES)[number]): string {
  const messages = readUiBundle('en', namespace);
  const canonical = Object.keys(messages)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => JSON.stringify([key, messages[key]]))
    .join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
