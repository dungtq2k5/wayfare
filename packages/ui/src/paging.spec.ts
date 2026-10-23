import { describe, expect, it } from 'vitest';
import { mergeCursorPages, pageCount, pageNumbers, pageRange } from './paging';

describe('pages', () => {
  it('count and range, as P1 says them', () => {
    expect(pageCount(248, 20)).toBe(13);
    expect(pageCount(0, 20)).toBe(1);
    expect(pageRange(1, 20, 248)).toEqual({ from: 1, to: 20 });
    expect(pageRange(13, 20, 248)).toEqual({ from: 241, to: 248 });
    expect(pageRange(1, 20, 0)).toEqual({ from: 0, to: 0 });
  });

  it('show the ends, the current page and its neighbours, and gaps between', () => {
    expect(pageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageNumbers(1, 13)).toEqual([1, 2, 3, 4, 5, 'gap', 13]);
    expect(pageNumbers(7, 13)).toEqual([1, 'gap', 6, 7, 8, 'gap', 13]);
    expect(pageNumbers(13, 13)).toEqual([1, 'gap', 9, 10, 11, 12, 13]);
    for (let page = 1; page <= 13; page++) {
      const slots = pageNumbers(page, 13);
      expect(slots.length).toBeLessThanOrEqual(7);
      expect(slots).toContain(page);
    }
  });
});

describe('a cursor', () => {
  it('joins its pages, keeping a repeated row where it was first shown', () => {
    expect(
      mergeCursorPages([
        [{ id: 'a' }, { id: 'b' }],
        [{ id: 'b' }, { id: 'c' }],
      ]).map((row) => row.id),
    ).toEqual(['a', 'b', 'c']);
  });
});
