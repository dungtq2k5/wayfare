import { newId } from '@wayfare/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate';
import { openTestDatabase } from '../db/test-database';
import { tourRecord } from '../testing/shell-fakes';
import { tourRecords } from '../tours/tour-records';
import { syncAreaTours } from './sync-tours';
import type { ToursClient, ToursPage } from './sync-tours';

const D1 = newId();

/** A client that answers these pages in turn, and records what it was asked. */
function client(pages: ToursPage[]) {
  const asked: (number | undefined)[] = [];
  const value: ToursClient = {
    tours: ({ since }) => {
      asked.push(since);
      return Promise.resolve(pages.shift()!);
    },
  };
  return { value, asked };
}

const page = (fields: Partial<ToursPage>): ToursPage => ({
  tours: [],
  removedTourIds: [],
  datasetVersion: 1,
  complete: true,
  ...fields,
});

describe('an area’s tours, synced (GET /sync/tours)', () => {
  let db: ReturnType<typeof openTestDatabase>;
  beforeEach(async () => {
    db = openTestDatabase();
    await migrate(db);
  });

  const sync = (tours: ToursClient) =>
    syncAreaTours({ db, client: tours, areaId: D1, lang: 'en', now: () => 9_000 });

  it('reads every page from the start, then only what changed since the stored version', async () => {
    const [t1, t2] = [newId(), newId()];
    const first = client([
      page({ tours: [tourRecord(t1, D1, [])], datasetVersion: 3, complete: false }),
      page({ tours: [tourRecord(t2, D1, [])], datasetVersion: 5 }),
    ]);
    expect(await sync(first.value)).toBe(2);
    expect(first.asked).toEqual([undefined, 3]);
    const later = client([page({ removedTourIds: [t1], datasetVersion: 6 })]);
    expect(await sync(later.value)).toBe(0);
    expect(later.asked).toEqual([5]);
    expect((await tourRecords(db, 'en', D1)).map((tour) => tour.id)).toEqual([t2]);
  });

  it('updates a tour it already holds', async () => {
    const id = newId();
    await sync(client([page({ tours: [tourRecord(id, D1, [])] })]).value);
    const renamed = { ...tourRecord(id, D1, []), estimatedMinutes: 90 };
    await sync(client([page({ tours: [renamed], datasetVersion: 2 })]).value);
    expect((await tourRecords(db, 'en')).map((tour) => tour.estimatedMinutes)).toEqual([90]);
  });

  it('removes more tours at once than one statement binds', async () => {
    const ids = Array.from({ length: 501 }, () => newId());
    await sync(client([page({ tours: ids.map((id) => tourRecord(id, D1, [])) })]).value);
    await sync(client([page({ removedTourIds: ids, datasetVersion: 2 })]).value);
    expect(await tourRecords(db, 'en')).toEqual([]);
  });

  it('stops when an incomplete page doesn’t move past the stored version', async () => {
    await sync(client([page({ datasetVersion: 4 })]).value);
    await expect(
      sync(client([page({ datasetVersion: 4, complete: false })]).value),
    ).rejects.toThrow(/not advancing past 4/);
  });

  it('keeps nothing of a page with a malformed tour', async () => {
    await expect(sync(client([page({ tours: [{ bad: true }] })]).value)).rejects.toThrow();
    expect(await tourRecords(db, 'en')).toEqual([]);
  });
});
