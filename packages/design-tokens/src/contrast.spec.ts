import { describe, expect, it } from 'vitest';
import tokens from '../tokens.json';

type Node = { $value?: unknown } & { [key: string]: unknown };

/** Follows `{a.b.c}` aliases to the colour they name. */
function resolve(value: unknown): string {
  let current = value;
  while (typeof current === 'string' && current.startsWith('{')) {
    const node = current
      .slice(1, -1)
      .split('.')
      .reduce<Node>((object, key) => object[key] as Node, tokens as unknown as Node);
    current = node.$value;
  }
  if (typeof current !== 'string') throw new Error(`Not a colour: ${String(value)}`);
  return current;
}

type Mode = 'light' | 'dark';

const semantic = (mode: Mode): Record<string, { $value: string }> =>
  (tokens.semantic[mode] as { color: Record<string, { $value: string }> }).color;

function colour(mode: Mode, name: string): string {
  const token = semantic(mode)[name];
  if (token === undefined) throw new Error(`No semantic colour ${name} in ${mode}`);
  return resolve(token.$value);
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5]
    .map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio. */
export function contrastRatio(first: string, second: string): number {
  const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (high + 0.05) / (low + 0.05);
}

/** Text on its own surface: every `X` on `X-foreground`. A new token pair joins this list deliberately. */
const SURFACES = [
  'primary',
  'secondary',
  'accent',
  'destructive',
  'card',
  'popover',
  'sponsored',
  'editorial',
  'success',
  'warning',
  'info',
  'offline',
  'now-playing',
  'map-marker',
  'map-marker-selected',
] as const;

const TEXT_ON = ['background', 'card'] as const;
const TEXT = ['foreground', 'muted-foreground'] as const;
const NON_TEXT = ['input', 'ring'] as const;

const MODES: readonly Mode[] = ['light', 'dark'];

/** One failing pair reads as its two names and its ratio. */
function check(mode: Mode, surface: string, ink: string, minimum: number): void {
  const ratio = contrastRatio(colour(mode, surface), colour(mode, ink));
  expect(
    ratio,
    `${mode}: ${ink} on ${surface} is ${ratio.toFixed(2)} : 1, below ${minimum} : 1`,
  ).toBeGreaterThanOrEqual(minimum);
}

describe.each(MODES)('contrast in %s', (mode) => {
  it.each(SURFACES)('%s-foreground on %s reaches 4.5 : 1', (surface) => {
    check(mode, surface, `${surface}-foreground`, 4.5);
  });

  it('keeps now-playing-accent readable on now-playing', () => {
    check(mode, 'now-playing', 'now-playing-accent', 4.5);
  });

  it.each(TEXT_ON.flatMap((surface) => TEXT.map((ink) => [surface, ink] as const)))(
    '%s text: %s reaches 4.5 : 1',
    (surface, ink) => {
      check(mode, surface, ink, 4.5);
    },
  );

  // Non-text contrast (WCAG 1.4.11): a field's edge and the focus ring must be seen. `border` is
  // decorative and exempt.
  it.each(NON_TEXT)('%s reaches 3 : 1 on background', (ink) => {
    check(mode, 'background', ink, 3);
  });
});

describe('the export', () => {
  it('names the same semantic colours in light and dark', () => {
    const byName = (a: string, b: string) => (a < b ? -1 : 1);
    expect(Object.keys(semantic('dark')).sort(byName)).toEqual(
      Object.keys(semantic('light')).sort(byName),
    );
  });

  it('resolves every semantic alias to a six-digit hex colour', () => {
    for (const mode of MODES) {
      for (const name of Object.keys(semantic(mode))) {
        expect(colour(mode, name), `${mode}: ${name}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });
});
