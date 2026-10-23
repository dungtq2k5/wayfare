import type { ConsoleArguments } from '@wayfare/i18n/generated/console-arguments';
import en from '@wayfare/i18n/locales/en/console.json';
import vi from '@wayfare/i18n/locales/vi/console.json';
import { IntlMessageFormat } from 'intl-messageformat';

/** The console's languages (K12): the bundles it ships. */
export const CONSOLE_LOCALES = ['vi', 'en'] as const;
export type ConsoleLocale = (typeof CONSOLE_LOCALES)[number];

export type Messages = Record<keyof typeof en, string>;
export const MESSAGES: Record<ConsoleLocale, Messages> = { en, vi };

type ArgumentKey = keyof ConsoleArguments;
export type PlainKey = Exclude<keyof Messages, ArgumentKey>;

/** `t`: a key without arguments takes none; a key with them requires the object ICU needs. */
export interface ConsoleT {
  <K extends PlainKey>(key: K): string;
  <K extends ArgumentKey>(key: K, args: ConsoleArguments[K]): string;
}

/** A key built at run time (an error code, a notification type): the generic text when unknown. */
export type DynamicT = (
  key: string,
  args?: Record<string, string | number>,
  fallback?: string,
) => string;

export interface Translator {
  readonly locale: ConsoleLocale;
  readonly t: ConsoleT;
  readonly tDynamic: DynamicT;
}

/** The typed translation functions of one language; formats are cached per key. */
export function createTranslator(locale: ConsoleLocale): Translator {
  const messages = MESSAGES[locale];
  const cache = new Map<string, IntlMessageFormat>();
  const format = (key: string, args?: Record<string, unknown>): string => {
    let formatter = cache.get(key);
    if (formatter === undefined) {
      formatter = new IntlMessageFormat(messages[key as keyof Messages], locale);
      cache.set(key, formatter);
    }
    return String(formatter.format(args as Record<string, string | number> | undefined));
  };
  return {
    locale,
    t: (key: string, args?: Record<string, unknown>) => format(key, args),
    tDynamic: (key, args, fallback) =>
      key in messages ? format(key, args) : (fallback ?? format('error.generic')),
  };
}
