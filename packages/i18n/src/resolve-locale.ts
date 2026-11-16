import { BUNDLE_LOCALES } from './locales';
import type { BundleLocale } from './locales';

/** A stored `preferred_locale` → the bundle to render with: its language, else `en`. */
export function resolveLocale(preferred: string | null | undefined): BundleLocale {
  const language = (preferred ?? '').split('-')[0]?.toLowerCase() ?? '';
  return (BUNDLE_LOCALES as readonly string[]).includes(language)
    ? (language as BundleLocale)
    : 'en';
}
