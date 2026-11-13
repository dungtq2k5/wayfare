// Guard: the mobile app's class names stay on the design tokens' scales (ADR 0061). The NativeWind
// preset replaces Tailwind's scales with the tokens, so a class off them (`h-40`, `rounded-3xl`)
// is not an error anywhere — it silently draws nothing, and the screen quietly differs from the
// design. A size outside the scale belongs in `src/ui/layout.ts`, named.
import { describe, expect, it } from 'vitest';
import { listFiles, readRepoFile } from './support/repo';

interface Tokens {
  space: Record<string, unknown>;
  radius: Record<string, unknown>;
}

const tokens = JSON.parse(readRepoFile('packages/design-tokens/tokens.json')) as Tokens;
// The token `0_5` is the class step `0.5`.
const SPACE = new Set(Object.keys(tokens.space).map((key) => key.replace('_', '.')));
const RADIUS = new Set(Object.keys(tokens.radius));

/** Spacing-scale utilities with a number: `p-4`, `min-h-12`, `-mt-2`, `gap-x-3`, `inset-x-0`. */
const SPACING =
  /(?<![\w-])-?(?:min-|max-)?(?:[hw]|size|gap(?:-[xy])?|[pm][xytblrse]?|inset(?:-[xy])?|top|bottom|left|right|space-[xy]|translate-[xy])-(\d+(?:\.\d+)?)(?![\w./-])/g;
/**
 * Corner utilities: `rounded-xl`, `rounded-t-2xl`, and a bare `rounded` or `rounded-t`, whose
 * default size the tokens do not define — it draws square corners.
 */
const ROUNDED =
  /(?<![\w-])rounded(?:-(?:[tblrse]|tl|tr|bl|br|ss|se|es|ee))?(?:-([\w.]+))?(?![\w-])/g;

/** Every off-scale class in one file, as `file:line: class`. */
export function scanClasses(file: string, text: string): string[] {
  const problems: string[] = [];
  text.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(SPACING)) {
      if (!SPACE.has(match[1]!)) problems.push(`${file}:${index + 1}: ${match[0].trim()}`);
    }
    for (const match of line.matchAll(ROUNDED)) {
      if (match[1] === undefined || !RADIUS.has(match[1]))
        problems.push(`${file}:${index + 1}: ${match[0].trim()}`);
    }
  });
  return problems;
}

describe('mobile class names', () => {
  it('stay on the tokens’ spacing and radius scales', () => {
    const files = listFiles('apps/mobile/app', 'apps/mobile/src').filter(
      (file) => file.endsWith('.tsx') && !file.endsWith('.spec.tsx'),
    );
    expect(files.length).toBeGreaterThan(0);
    expect(files.flatMap((file) => scanClasses(file, readRepoFile(file)))).toEqual([]);
  });

  it('catches what the scales lack, and lets the scales through', () => {
    expect(
      scanClasses('x.tsx', 'className="h-40 w-40 min-h-14 rounded-t-3xl p-4 rounded-full -mt-2"'),
    ).toEqual(['x.tsx:1: h-40', 'x.tsx:1: w-40', 'x.tsx:1: min-h-14', 'x.tsx:1: rounded-t-3xl']);
    expect(
      scanClasses('x.tsx', 'className="rounded rounded-t rounded-sm rounded-lg rounded-b-xl"'),
    ).toEqual(['x.tsx:1: rounded', 'x.tsx:1: rounded-t']);
    expect(
      scanClasses('x.tsx', 'className="min-h-target rounded-t-2xl gap-x-3 inset-x-0 py-0.5"'),
    ).toEqual([]);
  });
});
