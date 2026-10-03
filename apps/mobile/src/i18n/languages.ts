import { CONTENT_LANGUAGES, LONG_TAIL_LANGUAGES } from '@wayfare/contracts';
import type { Language } from '@wayfare/contracts';

/** Each language written in itself: a picker must be readable by someone who cannot read the rest. */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  vi: 'Tiếng Việt',
  en: 'English',
  'zh-Hans': '简体中文',
  ja: '日本語',
  ko: '한국어',
  'zh-Hant': '繁體中文',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  ru: 'Русский',
  th: 'ไทย',
  id: 'Bahasa Indonesia',
  ms: 'Bahasa Melayu',
  hi: 'हिन्दी',
};

/** The picker's first list, then what *Other* shows. */
export const TOP_LANGUAGES: readonly Language[] = CONTENT_LANGUAGES;
export const OTHER_LANGUAGES: readonly Language[] = LONG_TAIL_LANGUAGES;
