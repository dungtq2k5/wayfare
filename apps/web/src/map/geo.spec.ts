import { describe, expect, it } from 'vitest';
import { insidePolygon, metresBetween } from './geo';

const square = {
  coordinates: [
    [
      [106.69, 10.77],
      [106.71, 10.77],
      [106.71, 10.79],
      [106.69, 10.79],
      [106.69, 10.77],
    ],
  ],
};

describe('the map geometry', () => {
  it('tells a point inside an area from one outside it (WM4b)', () => {
    expect(insidePolygon({ lat: 10.78, lng: 106.7 }, square)).toBe(true);
    expect(insidePolygon({ lat: 10.8, lng: 106.7 }, square)).toBe(false);
  });

  it('measures metres between two points', () => {
    expect(Math.round(metresBetween({ lat: 10.77, lng: 106.7 }, { lat: 10.78, lng: 106.7 }))).toBe(
      1112,
    );
  });
});
