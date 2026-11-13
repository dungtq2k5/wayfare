import type { Language } from '@wayfare/contracts';

/**
 * Our language codes as Google Translation (and the Google-Translate route) spells them. Chinese
 * goes by region there; everything else is the same code. A language missing here is unsupported.
 */
export const GOOGLE_TRANSLATE_CODES: Readonly<Record<Language, string>> = {
  vi: 'vi',
  en: 'en',
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-TW',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
  ru: 'ru',
  th: 'th',
  id: 'id',
  ms: 'ms',
  hi: 'hi',
};

/** The provider code for `lang`, or null when the map has none. */
export function googleTranslateCode(lang: string): string | null {
  return Object.hasOwn(GOOGLE_TRANSLATE_CODES, lang)
    ? GOOGLE_TRANSLATE_CODES[lang as Language]
    : null;
}
