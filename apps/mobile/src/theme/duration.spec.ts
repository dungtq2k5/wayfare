import { describe, expect, it } from 'vitest';
import { durationFor } from './duration';

const durations = { fast: 120, normal: 200, slow: 320 } as const;

describe('durationFor', () => {
  it('is the token in milliseconds when animations are on', () => {
    expect(durationFor(durations, 'fast', false)).toBe(120);
    expect(durationFor(durations, 'slow', false)).toBe(320);
  });

  it('is 0 for every token when the system removes animations', () => {
    for (const token of ['fast', 'normal', 'slow'] as const) {
      expect(durationFor(durations, token, true)).toBe(0);
    }
  });
});
