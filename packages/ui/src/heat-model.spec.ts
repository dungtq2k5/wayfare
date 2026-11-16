import { describe, expect, it } from 'vitest';
import { heatSteps } from './heat-model';

describe('heatSteps', () => {
  it('shades each fifth of the squares a step, fewest to most', () => {
    const step = heatSteps([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect([5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(step)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it('gives equal estimates one step, and an empty map nothing to shade', () => {
    const flat = heatSteps([7, 7, 7, 7, 7]);
    expect(flat(7)).toBe(1);
    expect(heatSteps([])(12)).toBe(1);
    const two = heatSteps([5, 400]);
    expect([two(5), two(400)]).toEqual([3, 5]);
  });
});
