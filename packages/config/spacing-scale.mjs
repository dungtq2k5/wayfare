// The design tokens' spacing scale as the web's lint reads it (ADR 0061): a spacing class whose
// step is not a `space` key is refused, so a distance the design can't name never reaches a page.
import { readFileSync } from 'node:fs';

const tokens = JSON.parse(
  readFileSync(new URL('../design-tokens/tokens.json', import.meta.url), 'utf8'),
);

/** The class steps the scale allows: the token keys, `0_5` written as Tailwind's `0.5`. */
export const SPACE_STEPS = Object.keys(tokens.space)
  .map((key) => key.replace('_', '.'))
  .sort((a, b) => Number(a) - Number(b));

const allowed = SPACE_STEPS.map((step) => step.replace('.', '\\.')).join('|');

/**
 * A padding, margin, gap, space-between or position class with a number off the scale: `gap-1.5`,
 * `p-7`, `-mt-11`. Fractions (`left-1/2`), keywords (`mx-auto`) and sizes (`w-80`) are not spacing.
 */
export const OFF_SCALE_SPACING = `(?<![\\w-])-?(?:[pm][xytblrse]?|gap(?:-[xy])?|space-[xy]|inset(?:-[xy])?|top|bottom|left|right)-(?!(?:${allowed})(?![\\w.]))\\d[\\d.]*(?![\\w.])`;
