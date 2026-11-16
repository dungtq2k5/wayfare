import { LANGUAGE_ENGLISH_NAMES, LANGUAGE_NAMES, isSupportedLanguage } from '@wayfare/contracts';

/**
 * A language's own name ("Tiếng Việt", "简体中文"), as the app's picker writes it: a speaker finds
 * their language whatever the console's. The runtime's name, or the code, for one Wayfare doesn't serve.
 */
export function autonym(code: string): string {
  return isSupportedLanguage(code) ? LANGUAGE_NAMES[code] : displayName(code, code);
}

/** A language's name in the console's language ("Thai", "tiếng Thái"); the code when unknown. */
export function languageName(code: string, locale: string): string {
  return locale === 'en' && isSupportedLanguage(code)
    ? LANGUAGE_ENGLISH_NAMES[code]
    : displayName(code, locale);
}

function displayName(code: string, locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(code);
    return name === undefined ? code : name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  } catch {
    return code;
  }
}

/** A language to choose: its own name, and in brackets the console's when they differ ("ไทย (Thai)"). */
export function languageOption(code: string, locale: string): string {
  const own = autonym(code);
  const ours = languageName(code, locale);
  return own === ours ? own : `${own} (${ours})`;
}
