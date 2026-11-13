import {
  CONTENT_LANGUAGES,
  isSupportedLanguage,
  normalizeLang,
  SUPPORTED_LANGUAGES,
} from '@wayfare/contracts';
import type { Language } from '@wayfare/contracts';

/** The page's language, per browser (K7): a cookie, so the server renders in it. */
export const LANGUAGE_COOKIE = 'wf_web_lang';

/** The launch languages, in the picker's order (WL1). */
export const LAUNCH_ORDER: readonly Language[] = ['en', 'vi', 'ja', 'ko', 'zh-Hans'];

/** The rest, in the shared list's order. */
export const MORE_LANGUAGES: readonly Language[] = SUPPORTED_LANGUAGES.filter(
  (lang) => !(CONTENT_LANGUAGES as readonly string[]).includes(lang),
);

/** `Accept-Language`'s tags, most preferred first (`q` weights honoured, `*` ignored). */
export function acceptedTags(header: string | null | undefined): string[] {
  if (header === null || header === undefined || header.trim() === '') return [];
  return header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
      const weight = q === undefined ? 1 : Number(q.slice(2));
      return { tag: tag.trim(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.tag !== '' && entry.tag !== '*' && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map((entry) => entry.tag);
}

/**
 * The page's language (K7): the one chosen on this browser; else the first of the browser's
 * languages Wayfare speaks, without asking; else English, and `unsupported` says WQ6's bar shows.
 */
export function pageLanguage(
  cookie: string | null | undefined,
  acceptLanguage: string | null | undefined,
): { readonly lang: Language; readonly chosen: boolean; readonly unsupported: boolean } {
  if (isSupportedLanguage(cookie)) return { lang: cookie, chosen: true, unsupported: false };
  for (const tag of acceptedTags(acceptLanguage)) {
    const lang = normalizeLang(tag);
    if (lang !== null) return { lang, chosen: false, unsupported: false };
  }
  return { lang: 'en', chosen: false, unsupported: true };
}

/** The header button's short name: `EN`, `VI`, `日本`… — the language's own tag, upper case. */
export function shortName(lang: Language): string {
  return (lang.startsWith('zh-') ? lang.replace('zh-', 'ZH ') : lang).toUpperCase();
}
