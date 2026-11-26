import { newId } from '@wayfare/contracts';
import type { PlaceSyncRecordStored, TourSyncRecordStored } from '@wayfare/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate';
import { openTestDatabase } from '../db/test-database';
import { tourRecord } from '../testing/shell-fakes';
import {
  beginTour,
  finishedStories,
  localTour,
  markFinishedSeen,
  progressOf,
  recordFinishedStory,
  tourRecords,
  tourStart,
} from './tour-records';

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

// The server's rule: a stop is live while its Place is live in the tour's area. The phone holds
// only live Places, so a missing one or one now in another area is a gap.
const places = new Map([
  ['a', place('a', 'd1', 10.77)],
  ['moved', place('moved', 'd4', 10.76)],
  ['b', place('b', 'd1', 10.78)],
]);

describe('localTour', () => {
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

describe('a tour on this phone', () => {
  let db: ReturnType<typeof openTestDatabase>;
  beforeEach(async () => {
    db = openTestDatabase();
    await migrate(db);
  });

  const store = (record: ReturnType<typeof tourRecord>, lang = 'en') =>
    db.run('INSERT INTO tour_records (tour_id, lang, area_id, record_json) VALUES (?, ?, ?, ?)', [
      record.id,
      lang,
      record.areaId,
      JSON.stringify(record),
    ]);

  it('reads a language’s tours, in an area or every area, in a stable order', async () => {
    const [d1, d4] = [newId(), newId()];
    const [a, b] = [newId(), newId()].sort((x, y) => x.localeCompare(y));
    await store(tourRecord(b!, d1, []));
    await store(tourRecord(a!, d4, []));
    await store(tourRecord(newId(), d1, []), 'vi');
    expect((await tourRecords(db, 'en')).map((tour) => tour.id)).toEqual([a, b]);
    expect((await tourRecords(db, 'en', d1)).map((tour) => tour.id)).toEqual([b]);
  });

  it('keeps each Place’s latest finish, never an earlier one', async () => {
    await recordFinishedStory(db, 'p1', 200);
    await recordFinishedStory(db, 'p1', 100);
    await recordFinishedStory(db, 'p2', 50);
    expect(await finishedStories(db)).toEqual(
      new Map([
        ['p1', 200],
        ['p2', 50],
      ]),
    );
  });

  it('begins a tour once; walking it again moves the start and clears the finish seen', async () => {
    expect(await tourStart(db, 't1')).toBeNull();
    await beginTour(db, 't1', 1_000);
    await beginTour(db, 't1', 2_000);
    expect(await tourStart(db, 't1')).toEqual({ startedAt: 1_000, finishedSeenAt: null });
    await markFinishedSeen(db, 't1', 3_000);
    expect(await tourStart(db, 't1')).toEqual({ startedAt: 1_000, finishedSeenAt: 3_000 });
    await beginTour(db, 't1', 4_000, true);
    expect(await tourStart(db, 't1')).toEqual({ startedAt: 4_000, finishedSeenAt: null });
  });

  it('counts the live stops heard since the start, and the time once all are heard', () => {
    const tour = localTour(record, places);
    const before = progressOf(tour, new Map([['a', 500]]), {
      startedAt: 1_000,
      finishedSeenAt: null,
    });
    expect(before.durationMs).toBeNull();
    const done = progressOf(
      tour,
      new Map([
        ['a', 2_000],
        ['b', 5_000],
      ]),
      { startedAt: 1_000, finishedSeenAt: null },
    );
    expect(done.durationMs).toBe(4_000);
    expect(progressOf(tour, new Map(), null).durationMs).toBeNull();
  });
});
