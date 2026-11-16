import { describe, expect, it } from 'vitest';
import { insidePolygon, pinMove } from './geo';

describe('the location diff (K11)', () => {
  it('says metres and a compass direction', () => {
    // About 20 m east, as frame S3 draws it.
    expect(pinMove({ lat: 10.7586, lng: 106.7024 }, { lat: 10.7586, lng: 106.70258 })).toEqual({
      metres: 20,
      direction: 'east',
    });
    expect(pinMove({ lat: 10.77, lng: 106.69 }, { lat: 10.7709, lng: 106.69 }).direction).toBe(
      'north',
    );
    expect(pinMove({ lat: 10.77, lng: 106.69 }, { lat: 10.7694, lng: 106.6894 }).direction).toBe(
      'southwest',
    );
    expect(pinMove({ lat: 10.77, lng: 106.69 }, { lat: 10.77, lng: 106.69 }).metres).toBe(0);
  });
});

describe('the area a pin is in', () => {
  it('finds a point inside a ring and not outside it', () => {
    const square: [number, number][] = [
      [106.69, 10.77],
      [106.71, 10.77],
      [106.71, 10.79],
      [106.69, 10.79],
      [106.69, 10.77],
    ];
    expect(insidePolygon({ lat: 10.78, lng: 106.7 }, square)).toBe(true);
    expect(insidePolygon({ lat: 10.8, lng: 106.7 }, square)).toBe(false);
  });
});
