import { describe, expect, it } from 'vitest';
import { compareStrings } from './sorting';

describe('compareStrings', () => {
  it('orders by code unit, uppercase before lowercase', () => {
    expect(['b', 'B', 'a', 'A'].toSorted(compareStrings)).toEqual(['A', 'B', 'a', 'b']);
  });

  it('orders punctuation by code unit, not by locale rules', () => {
    expect(['a-b', 'a_b', 'ab', 'a.b'].toSorted(compareStrings)).toEqual([
      'a-b',
      'a.b',
      'a_b',
      'ab',
    ]);
  });

  it('never treats DISTINCT strings as equal (a locale compare ignores a zero-width space)', () => {
    expect(compareStrings('a', 'a\u200b')).not.toBe(0);
  });

  it('is zero for identical strings and flips sign when the arguments swap', () => {
    expect(compareStrings('x', 'x')).toBe(0);
    expect(compareStrings('a', 'b')).toBe(-1);
    expect(compareStrings('b', 'a')).toBe(1);
  });
});
