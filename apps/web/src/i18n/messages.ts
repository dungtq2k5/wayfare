import type { Language } from '@wayfare/contracts';
import type { WebArguments } from '@wayfare/i18n/generated/web-arguments';
import touristEn from '@wayfare/i18n/locales/en/tourist.json';
import en from '@wayfare/i18n/locales/en/web.json';
import touristVi from '@wayfare/i18n/locales/vi/tourist.json';
import vi from '@wayfare/i18n/locales/vi/web.json';
import { IntlMessageFormat } from 'intl-messageformat';

/** A flat `{ key: ICU string }` bundle. */
export type Messages = Record<string, string>;

/**
 * The names the Android app's bundle already holds — `category.*` and `area.*` — read by
 * `tDynamic`, so the two apps never say a category's name differently.
 */
const SHARED_FAMILIES = /^(category|area)\.[^.]+(\.subtitle)?$/;
export const sharedNames = (bundle: Messages): Messages =>
  Object.fromEntries(Object.entries(bundle).filter(([key]) => SHARED_FAMILIES.test(key)));

/** The two languages shipped with the app (K1); every other one comes from `/i18n/bundles`. */
export const BUNDLED: Readonly<Partial<Record<Language, Messages>>> = {
  en: { ...sharedNames(touristEn), ...en },
  vi: { ...sharedNames(touristVi), ...vi },
};

/** English, which any other language's missing keys fall back to. */
export const ENGLISH: Messages = BUNDLED.en!;

type ArgumentKey = keyof WebArguments;
export type PlainKey = Exclude<keyof typeof en, ArgumentKey>;

/** `t`: a key without arguments takes none; a key with them requires the object ICU needs. */
export interface WebT {
  <K extends PlainKey>(key: K): string;
  <K extends ArgumentKey>(key: K, args: WebArguments[K]): string;
}

/** A key built at run time (an error code, a category): the generic text when unknown. */
export type DynamicT = (
  key: string,
  args?: Record<string, string | number>,
  fallback?: string,
) => string;

export interface Translator {
  readonly locale: Language;
  readonly t: WebT;
  readonly tDynamic: DynamicT;
}

/** The typed translation functions of one language; formats are cached per key. */
export function createTranslator(locale: Language, messages: Messages): Translator {
  const cache = new Map<string, IntlMessageFormat>();
  const format = (key: string, args?: Record<string, unknown>): string => {
    let formatter = cache.get(key);
    if (formatter === undefined) {
      const source = messages[key] ?? ENGLISH[key] ?? key;
      try {
        formatter = new IntlMessageFormat(source, locale);
      } catch {
        // A machine translation that broke its ICU: the English one, always valid.
        formatter = new IntlMessageFormat(ENGLISH[key] ?? key, 'en');
      }
      cache.set(key, formatter);
    }
    return String(formatter.format(args as Record<string, string | number> | undefined));
  };
  return {
    locale,
    t: (key: string, args?: Record<string, unknown>) => format(key, args),
    tDynamic: (key, args, fallback) => {
      if (!(key in messages) && !(key in ENGLISH)) return fallback ?? format('error.generic');
      try {
        return format(key, args);
      } catch {
        return fallback ?? format('error.generic');
      }
    },
  };
}
