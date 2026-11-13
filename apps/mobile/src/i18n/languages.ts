import { CONTENT_LANGUAGES, LONG_TAIL_LANGUAGES } from '@wayfare/contracts';
import type { Language } from '@wayfare/contracts';

export { LANGUAGE_ENGLISH_NAMES, LANGUAGE_NAMES } from '@wayfare/contracts';

/** The picker's first list, then what *Other* shows. */
export const TOP_LANGUAGES: readonly Language[] = CONTENT_LANGUAGES;
export const OTHER_LANGUAGES: readonly Language[] = LONG_TAIL_LANGUAGES;
