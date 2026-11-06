import { describe, expect, it } from 'vitest';
import { tourDuration, tourProgress } from './progress';

const stops = [
  { position: 0, placeId: 'a' },
  { position: 1, placeId: 'b' },
  { position: 2, placeId: null },
  { position: 3, placeId: 'd' },
];

describe("a tour's progress on this browser", () => {
  it('counts stories finished since the start, in any order; next is the first not played', () => {
    const progress = tourProgress(stops, new Map([['b', 200]]), 100);
    expect([...progress.played]).toEqual([1]);
    expect(progress.next).toBe(0);
  });

  it("doesn't count one finished before the tour began, nor a gap", () => {
    const progress = tourProgress(
      stops,
      new Map([
        ['a', 50],
        ['b', 150],
      ]),
      100,
    );
    expect([...progress.played]).toEqual([1]);
    expect(
      tourProgress(
        stops,
        new Map([
          ['a', 150],
          ['b', 150],
        ]),
        100,
      ).next,
    ).toBe(3);
  });

  it('has nothing played before its first Play, and no next once all are', () => {
    expect(tourProgress(stops, new Map([['a', 1]]), null).played.size).toBe(0);
    const all = new Map([
      ['a', 200],
      ['b', 200],
      ['d', 200],
    ]);
    expect(tourProgress(stops, all, 100).next).toBeNull();
  });

  it('takes the time from the start to the last finish, once all are played', () => {
    const all = new Map([
      ['a', 200],
      ['b', 400],
      ['d', 300],
    ]);
    expect(tourDuration(stops, all, 100)).toBe(300);
    expect(tourDuration(stops, new Map([['a', 200]]), 100)).toBeNull();
  });
});
