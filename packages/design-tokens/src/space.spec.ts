import { describe, expect, it } from 'vitest';
import tokens from '../tokens.json';

describe('space', () => {
  it('is the 4 px step, with a 2 px half-step', () => {
    const steps = Object.fromEntries(
      Object.entries(tokens.space).map(([key, token]) => [key, token.$value]),
    );
    expect(steps['0_5']).toBe('2px');
    for (const [key, value] of Object.entries(steps))
      expect(value).toBe(`${Number(key.replace('_', '.')) * 4}px`);
  });
});
