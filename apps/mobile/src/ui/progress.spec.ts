import { describe, expect, it } from 'vitest';
import { displayedFraction } from './progress';

describe('the displayed fraction', () => {
  it('follows the real value up', () => {
    expect(displayedFraction(0.2, 0.5, true)).toBe(0.5);
  });

  it('holds within a run when the real value falls', () => {
    expect(displayedFraction(0.5, 0.4, true)).toBe(0.5);
  });

  it('starts a new run from its own value', () => {
    expect(displayedFraction(0.6, 0, false)).toBe(0);
  });
});
