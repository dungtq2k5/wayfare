import { describe, expect, it } from 'vitest';
import { distanceMeters } from '../ranking/distance';
import { liveStopCount, shownToTourists, tourDistanceM, tourStops } from './tour-stops';

const a = { lat: 10.7769, lng: 106.7009 };
const b = { lat: 10.7779, lng: 106.7009 };
const c = { lat: 10.7779, lng: 106.7029 };

describe('a tour for tourists', () => {
  it('keeps every position, a gap included, and measures a leg across the gap', () => {
    const stops = tourStops([
      { position: 2, live: c },
      { position: 0, live: a },
      { position: 1, live: null },
    ]);
    expect(stops).toEqual([
      { position: 0, live: true, legM: 0 },
      { position: 1, live: false, legM: 0 },
      { position: 2, live: true, legM: distanceMeters(a, c) },
    ]);
  });

  it('is shown with two live stops, not with one', () => {
    expect(
      shownToTourists([
        { position: 0, live: a },
        { position: 1, live: b },
      ]),
    ).toBe(true);
    expect(
      shownToTourists([
        { position: 0, live: a },
        { position: 1, live: null },
      ]),
    ).toBe(false);
    expect(liveStopCount([{ position: 0, live: null }])).toBe(0);
  });

  it('sums the straight legs between consecutive stops', () => {
    expect(tourDistanceM([a, b, c])).toBe(distanceMeters(a, b) + distanceMeters(b, c));
    expect(tourDistanceM([a])).toBe(0);
  });
});
