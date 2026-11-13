import { sameIcuArguments } from '@wayfare/i18n';

/** One translated key: the string to store, and whether it had to fall back to English. */
export interface CheckedKey {
  readonly key: string;
  readonly message: string;
  readonly fellBack: boolean;
}

/**
 * A translated key, checked against its English source (rdm-spec N-6). A translation that lost or
 * invented an ICU placeholder renders "You have  places" and passes every test that does not
 * render it, so the English string is kept for that key and the key is reported.
 */
export function checkedKey(key: string, source: string, translated: string): CheckedKey {
  return sameIcuArguments(source, translated)
    ? { key, message: translated, fellBack: false }
    : { key, message: source, fellBack: true };
}

/** The keys that fell back, in the order they were translated. */
export function failedKeysOf(checked: readonly CheckedKey[]): string[] {
  return checked.filter((entry) => entry.fellBack).map((entry) => entry.key);
}

/** The messages to store: the translation where it held, English where it did not. */
export function messagesOf(checked: readonly CheckedKey[]): Record<string, string> {
  return Object.fromEntries(checked.map((entry) => [entry.key, entry.message]));
}
