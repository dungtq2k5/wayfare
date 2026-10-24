/**
 * A language's own name ("Tiếng Việt", "日本語"), as the narration table shows it: a speaker finds
 * their language whatever the console's. The code when the runtime does not know it.
 */
export function autonym(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    return name === undefined ? code : name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    return code;
  }
}
