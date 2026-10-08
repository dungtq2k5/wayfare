import type en from '@wayfare/i18n/locales/en/tourist.json';
import type { TouristArguments } from '@wayfare/i18n/generated/tourist-arguments';
import type { i18n as I18n } from 'i18next';

type Messages = typeof en;
type ArgumentKey = keyof TouristArguments;
type PlainKey = Exclude<keyof Messages, ArgumentKey>;

/** `t`: a key without arguments takes none; a key with them requires the object ICU needs. */
export interface TouristT {
  <K extends PlainKey>(key: K): string;
  <K extends ArgumentKey>(key: K, args: TouristArguments[K]): string;
}

/** The key families built at run time, whose members are the English file's keys under that prefix. */
export type KeyFamily = 'area' | 'category' | 'error' | 'weekday';

export interface Tourist {
  t: TouristT;
  /**
   * `` `${family}.${suffix}` ``, or `fallback` when the English source has no such key — and, for
   * `error`, `error.generic` — so a code the app does not know yet still renders something.
   */
  tFamily: (family: KeyFamily, suffix: string, fallback?: string) => string;
}

/** The typed translation functions of one i18next instance. */
export function touristFrom(i18n: I18n): Tourist {
  const translate = i18n.t.bind(i18n) as (key: string, args?: object) => string;
  return {
    t: (key: string, args?: object) => translate(key, args),
    tFamily: (family, suffix, fallback) => {
      const key = `${family}.${suffix}`;
      if (i18n.exists(key)) return translate(key);
      return fallback ?? (family === 'error' ? translate('error.generic') : suffix);
    },
  };
}
