import type { PlaceSyncRecordStored, TourSyncRecordStored } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { localTour } from './tour-records';

const place = (id: string, areaId: string, lat: number) =>
  ({ id, areaId, location: { lat, lng: 106.7 } }) as unknown as PlaceSyncRecordStored;

const record = {
  id: 't1',
  areaId: 'd1',
  stops: [
    { position: 0, placeId: 'a' },
    { position: 1, placeId: 'gone' },
    { position: 2, placeId: 'moved' },
    { position: 3, placeId: 'b' },
  ],
} as unknown as TourSyncRecordStored;

describe('localTour', () => {
  // The server's rule: a stop is live while its Place is live in the tour's area. The phone holds
  // only live Places, so a missing one or one now in another area is a gap.
  const places = new Map([
    ['a', place('a', 'd1', 10.77)],
    ['moved', place('moved', 'd4', 10.76)],
    ['b', place('b', 'd1', 10.78)],
  ]);

  it('keeps every position and marks a gap where the Place is not live in the area', () => {
    const tour = localTour(record, places);
    expect(tour.stops.map((stop) => [stop.position, stop.place?.id ?? null])).toEqual([
      [0, 'a'],
      [1, null],
      [2, null],
      [3, 'b'],
    ]);
    expect(tour.liveCount).toBe(2);
  });

  it('measures a leg from the previous live stop, a gap leg zero', () => {
    const legs = localTour(record, places).stops.map((stop) => stop.legM);
    expect(legs[0]).toBe(0);
    expect(legs[1]).toBe(0);
    expect(legs[2]).toBe(0);
    // 0.01° of latitude, about 1.1 km.
    expect(legs[3]).toBeGreaterThan(1_000);
    expect(legs[3]).toBeLessThan(1_200);
  });
});
