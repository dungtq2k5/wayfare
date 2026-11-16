import { typography } from '@wayfare/design-tokens/tokens';

/** Scripts whose marks above and below the line clip at the tokens' line heights. */
const TALL_SCRIPTS: readonly string[] = ['th', 'hi'];
const TALL_SCRIPT_LEADING = 1.25;

/**
 * Every text style's line height for `language`, as the preset's `--leading-*` variables, or null
 * when the tokens' own heights serve: Thai and Devanagari get × 1.25, set once at the app's root
 * with `vars()`.
 *
 * ponytail: no font per script. Android's fallback draws CJK, Thai, Devanagari and Cyrillic in its
 * Noto fonts beside Be Vietnam Pro; switch Cyrillic to a system font if mixed Russian reads badly.
 */
export function scriptLeading(language: string | null): Record<string, number> | null {
  if (language === null || !TALL_SCRIPTS.includes(language)) return null;
  return Object.fromEntries(
    Object.entries(typography).map(([name, style]) => [
      `--leading-${name}`,
      Math.round(style.lineHeight * TALL_SCRIPT_LEADING),
    ]),
  );
}
