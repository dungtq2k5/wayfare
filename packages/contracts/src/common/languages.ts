import { z } from 'zod';

/** The language every source text is written in (rdm-spec §2.3). */
export const SOURCE_LANGUAGE = 'vi';

/** The launch languages, normalized BCP 47 (rdm-spec §2.3). Chinese is `zh-Hans`, never `zh`. */
export const CONTENT_LANGUAGES = ['vi', 'en', 'zh-Hans', 'ja', 'ko'] as const;
/** A launch language. */
export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number];

/** The `BASIC` narration scope's languages (rdm-spec B-1). */
export const BASIC_LANGUAGES = ['vi', 'en'] as const satisfies readonly ContentLanguage[];

/**
 * The long-tail languages the `EXTENDED` scope adds (rdm-spec B-1). A closed list: a language
 * outside it never starts a translation job.
 */
export const LONG_TAIL_LANGUAGES = [
  'zh-Hant',
  'fr',
  'de',
  'es',
  'ru',
  'th',
  'id',
  'ms',
  'hi',
] as const;
/** A long-tail language. */
export type LongTailLanguage = (typeof LONG_TAIL_LANGUAGES)[number];

/** Every language Wayfare serves. */
export type Language = ContentLanguage | LongTailLanguage;
/** Every served language, launch languages first. */
export const SUPPORTED_LANGUAGES: readonly Language[] = [
  ...CONTENT_LANGUAGES,
  ...LONG_TAIL_LANGUAGES,
];

/** Upper bound of a BCP 47 language code column (rdm-spec §2.3). */
export const MAX_LANGUAGE_CODE_LENGTH = 16;

/** A syntactically well-formed BCP 47 tag — a syntax check, not a registry lookup. */
export const LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

const TRADITIONAL_CHINESE_REGIONS = new Set(['tw', 'hk', 'mo']);

/** True when `value` is a served language, already in our spelling. */
export function isSupportedLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * A BCP 47 tag → our spelling, or null when we do not serve it. Regions are dropped
 * (`EN-us` → `en`); Chinese resolves by script, then by region (`zh-TW` → `zh-Hant`).
 */
export function normalizeLang(tag: string): Language | null {
  if (tag.length > MAX_LANGUAGE_CODE_LENGTH || !LANGUAGE_TAG_PATTERN.test(tag)) return null;
  const [primary = '', ...subtags] = tag.toLowerCase().split('-');
  if (primary === 'zh') {
    if (subtags.includes('hans')) return 'zh-Hans';
    if (subtags.includes('hant')) return 'zh-Hant';
    return subtags.some((subtag) => TRADITIONAL_CHINESE_REGIONS.has(subtag))
      ? 'zh-Hant'
      : 'zh-Hans';
  }
  return isSupportedLanguage(primary) ? primary : null;
}

/** Strict: writes, events and admin routes. An unsupported language is a validation failure. */
export const zLanguage = z
  .string()
  .max(MAX_LANGUAGE_CODE_LENGTH)
  .transform((tag, ctx) => {
    const lang = normalizeLang(tag);
    if (lang === null) {
      ctx.addIssue({ code: 'custom', message: 'Unsupported language' });
      return z.NEVER;
    }
    return lang;
  });

/** The outcome of reading a tourist's `?lang=`. */
export interface RequestedLanguage {
  /** The tag as sent. */
  readonly tag: string;
  /** The served language it resolves to, or null — the fallback chain applies, and no job is scheduled. */
  readonly lang: Language | null;
}

/**
 * Lenient: a tourist's `?lang=` (api-endpoints-plan §0.6). Any well-formed tag passes; an
 * unsupported one is not an error.
 */
export const zRequestedLanguage = z
  .string()
  .max(MAX_LANGUAGE_CODE_LENGTH)
  .regex(LANGUAGE_TAG_PATTERN)
  .transform((tag): RequestedLanguage => ({ tag, lang: normalizeLang(tag) }));
