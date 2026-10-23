import { CONSOLE_LOCALES } from './messages';
import type { ConsoleLocale } from './messages';

/** The cookie the sign-in page's language switch sets (K6), read by every signed-out page. */
export const LANGUAGE_COOKIE = 'wf_lang';

/** A stored or requested language → the console's, or null when it serves neither. */
export function consoleLocaleOf(value: string | null | undefined): ConsoleLocale | null {
  const language = (value ?? '').trim().split(/[-_]/)[0]?.toLowerCase() ?? '';
  return (CONSOLE_LOCALES as readonly string[]).includes(language)
    ? (language as ConsoleLocale)
    : null;
}

/**
 * The language of a signed-out page (K12): the switch's cookie; else the browser's first choice
 * among Vietnamese and English, by `Accept-Language`'s weights; else Vietnamese, the product
 * owner's default.
 */
export function signedOutLocale(
  cookie: string | null | undefined,
  acceptLanguage: string | null | undefined,
): ConsoleLocale {
  const chosen = consoleLocaleOf(cookie);
  if (chosen !== null) return chosen;
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const weight = params.map((param) => /^\s*q=([\d.]+)\s*$/.exec(param)?.[1]).find(Boolean);
      return { tag, weight: weight === undefined ? 1 : Number(weight), index };
    })
    .filter((entry) => entry.tag !== '' && entry.weight > 0)
    .sort((left, right) => right.weight - left.weight || left.index - right.index);
  for (const entry of ranked) {
    const locale = consoleLocaleOf(entry.tag);
    if (locale !== null) return locale;
  }
  return 'vi';
}

/** A signed-in page's language (K12): the account's, which wins on every device. */
export function accountLocale(preferredLocale: string): ConsoleLocale {
  return consoleLocaleOf(preferredLocale) ?? 'vi';
}
