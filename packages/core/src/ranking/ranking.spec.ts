import { describe, expect, it } from 'vitest';
import { distanceMeters } from './distance';
import { BOOST_RANK_FACTOR, rankDistance, rankNearby } from './nearby';
import { WALK_DETOUR_FACTOR, WALKING_SPEED_M_PER_S, walkingEtaMinutes } from './walking';

const place = (id: string, distanceM: number, discoveryBoost = 0) => ({
  id,
  distanceM,
  discoveryBoost,
});

const summary = (items: ReturnType<typeof rankNearby>) =>
  items.map((item) => `${item.id}${item.sponsored ? '*' : ''}`);

describe('rankNearby', () => {
  it('orders an unboosted list by distance, with no flags', () => {
    expect(summary(rankNearby([place('c', 300), place('a', 100), place('b', 200)]))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('flags a boosted Place that moved ahead of a closer one', () => {
    // 150 m at boost 100 ranks as 75 m, ahead of the 100 m Place.
    expect(summary(rankNearby([place('near', 100), place('boosted', 150, 100)]))).toEqual([
      'boosted*',
      'near',
    ]);
  });

  it('does not flag a boosted Place that is also the closest', () => {
    expect(summary(rankNearby([place('boosted', 50, 100), place('far', 100)]))).toEqual([
      'boosted',
      'far',
    ]);
  });

  it('does not flag a boost too small to change the order', () => {
    expect(summary(rankNearby([place('near', 100), place('boosted', 200, 10)]))).toEqual([
      'near',
      'boosted',
    ]);
  });

  it('flags only the Places that moved, not the ones they passed', () => {
    const ranked = rankNearby([
      place('a', 100),
      place('b', 120),
      place('c', 400, 100), // ranks as 200: still last
      place('d', 250, 100), // ranks as 125: passes e
      place('e', 180, 50), // ranks as 135: passes nothing
    ]);
    expect(summary(ranked)).toEqual(['a', 'b', 'd*', 'e', 'c']);
  });

  it('is stable for equal distances, by id', () => {
    const ranked = rankNearby([place('b', 100), place('a', 100), place('c', 100, 0)]);
    expect(summary(ranked)).toEqual(['a', 'b', 'c']);
  });

  it('breaks a rank tie on the plain distance', () => {
    // 200 m at boost 100 ranks as 100 m, tying the unboosted 100 m Place, which stays first.
    expect(summary(rankNearby([place('boosted', 200, 100), place('plain', 100)]))).toEqual([
      'plain',
      'boosted',
    ]);
  });

  it('clamps an out-of-range boost', () => {
    expect(rankDistance(place('x', 100, 1000))).toBe(100 * (1 - BOOST_RANK_FACTOR));
    expect(rankDistance(place('x', 100, -5))).toBe(100);
  });

  it('keeps the caller fields', () => {
    const [first] = rankNearby([{ ...place('a', 10), name: 'A' }]);
    expect(first).toEqual({
      id: 'a',
      distanceM: 10,
      discoveryBoost: 0,
      name: 'A',
      sponsored: false,
    });
  });

  it('ranks an empty list', () => {
    expect(rankNearby([])).toEqual([]);
  });
});

describe('walkingEtaMinutes', () => {
  it.each([
    [0, 0],
    [1, 1],
    [100, 2],
    [5000, Math.ceil((5000 * WALK_DETOUR_FACTOR) / WALKING_SPEED_M_PER_S / 60)],
  ])('%i m → %i min', (distance, minutes) => {
    expect(walkingEtaMinutes(distance)).toBe(minutes);
  });

  it('is 0 for a negative or non-finite distance', () => {
    expect(walkingEtaMinutes(-1)).toBe(0);
    expect(walkingEtaMinutes(Number.NaN)).toBe(0);
  });
});

describe('distanceMeters', () => {
  it('measures a straight line in whole metres', () => {
    // 0.001° of latitude is about 111 m.
    expect(distanceMeters({ lat: 10.77, lng: 106.7 }, { lat: 10.771, lng: 106.7 })).toBe(111);
    expect(distanceMeters({ lat: 10.77, lng: 106.7 }, { lat: 10.77, lng: 106.7 })).toBe(0);
  });
});
