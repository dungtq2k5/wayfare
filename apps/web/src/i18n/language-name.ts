import { LANGUAGE_ENGLISH_NAMES, isSupportedLanguage } from '@wayfare/contracts';

/** A language's name in the page's language ("Told in Japanese", "Kể bằng tiếng Nhật"). */
export function languageName(tag: string, pageLocale: string): string {
  try {
    const name = new Intl.DisplayNames([pageLocale], { type: 'language' }).of(tag);
    if (name !== undefined && name !== tag) return name;
  } catch {
    // An engine without the locale's data: the English name below.
  }
  return isSupportedLanguage(tag) ? LANGUAGE_ENGLISH_NAMES[tag] : tag;
}
