import { describe, expect, it } from 'vitest';
import { formatDistance, joinNames, splitWalk } from './format-distance';

describe('formatDistance', () => {
  it.each([
    [0, '0 m'],
    [123, '123 m'],
    [999, '999 m'],
    [1000, '1.0 km'],
    [16470, '16.5 km'],
  ])('%i m reads %s', (metres, text) => {
    expect(formatDistance(metres)).toBe(text);
  });
});

describe('splitWalk', () => {
  it('splits a long walk into hours and minutes', () => {
    expect(splitWalk(59)).toEqual({ hours: 0, minutes: 59 });
    expect(splitWalk(286)).toEqual({ hours: 4, minutes: 46 });
  });
});

describe('joinNames', () => {
  it('joins with the language’s and', () => {
    expect(joinNames([], ' and ')).toBe('');
    expect(joinNames(['A'], ' and ')).toBe('A');
    expect(joinNames(['A', 'B'], ' and ')).toBe('A and B');
    expect(joinNames(['A', 'B', 'C'], ' và ')).toBe('A, B và C');
  });
});
