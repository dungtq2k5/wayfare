import { newId } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { openTestDatabase } from '../db/test-database';
import { migrate } from '../db/migrate';
import type { Database } from '../db/database';
import { clearLocalData, cursorOf, singleFlight, syncArea, syncAreas, syncTag } from './sync';
import type { SyncClient, SyncPage } from './sync';

const D1 = newId();
const D4 = newId();

interface ServerPlace {
  id: string;
  areaId: string;
  active: boolean;
  version: number;
  name: string;
}

/** The catalog's sync read, as the server does it: one version across areas, every change listed. */
class FakeServer {
  places = new Map<string, ServerPlace>();
  version = 0;
  pageSize = 500;
  requests: { areaId: string; since: number | undefined; ifNoneMatch: string | undefined }[] = [];
  /** Fails the n-th (1-based) record parse by serving a malformed one. */
  poisonNth: number | null = null;

  put(id: string, areaId: string, name: string, active = true): void {
    this.version += 1;
    this.places.set(id, { id, areaId, active, version: this.version, name });
  }

  record(place: ServerPlace) {
    return {
      id: place.id,
      kind: 'EDITORIAL',
      publicCode: 'ABCDEFGH',
      categoryCode: 'STREET_FOOD',
      areaId: place.areaId,
      location: { lat: 10.77, lng: 106.7 },
      triggerRadiusM: 40,
      narrationPriority: 0,
      autoNarrationEnabled: true,
      localization: {
        lang: 'en',
        name: place.name,
        description: '',
        contentTier: 'REQUESTED',
        stale: false,
        audio: null,
      },
      cardPhoto: null,
      priceBand: null,
      openingHours: [],
    };
  }

  client: SyncClient = {
    places: ({ areaId, lang, since, ifNoneMatch }) => {
      this.requests.push({ areaId, since, ifNoneMatch });
      const from = since ?? 0;
      const changed = [...this.places.values()]
        .filter((place) => place.version > from)
        .sort((a, b) => a.version - b.version);
      const full = changed.length > this.pageSize;
      const page = full ? changed.slice(0, this.pageSize) : changed;
      const datasetVersion = full ? page.at(-1)!.version : Math.max(this.version, from);
      if (ifNoneMatch === syncTag(areaId, lang, datasetVersion)) return Promise.resolve(undefined);
      const live = (place: ServerPlace) => place.active && place.areaId === areaId;
      const places = page.filter(live).map((place) => this.record(place));
      if (this.poisonNth !== null) places[this.poisonNth - 1] = { bad: true } as never;
      const response: SyncPage = {
        places,
        removedPlaceIds: from === 0 ? [] : page.filter((place) => !live(place)).map((p) => p.id),
        datasetVersion,
        complete: !full,
      };
      return Promise.resolve(response);
    },
  };
}

async function setup() {
  const db = openTestDatabase();
  await migrate(db);
  return { db, server: new FakeServer() };
}

const ids = async (db: Database, areaId: string) =>
  (
    await db.all<{ place_id: string }>(
      'SELECT place_id FROM place_records WHERE area_id = ? ORDER BY place_id',
      [areaId],
    )
  ).map((row) => row.place_id);

const run = (db: Database, server: FakeServer, areaId: string, lang = 'en') =>
  syncArea({ db, client: server.client, areaId, lang, now: () => 1_000 });

describe('syncTag', () => {
  it('is the quoted tag the gateway sends', () => {
    expect(syncTag('a', 'en', 7)).toBe('"a:en:7"');
  });
});

describe('syncArea', () => {
  it('stores every live Place on a first sync, and omits since and If-None-Match', async () => {
    const { db, server } = await setup();
    const a = newId();
    server.put(a, D1, 'A');
    server.put(newId(), D4, 'other area');
    const result = await run(db, server, D1);
    expect(server.requests[0]).toEqual({ areaId: D1, since: undefined, ifNoneMatch: undefined });
    expect(result).toMatchObject({ pages: 1, written: 1, unchanged: false, datasetVersion: 2 });
    expect(await ids(db, D1)).toEqual([a]);
    expect(await cursorOf(db, D1, 'en')).toBe(2);
  });

  it('answers 304 as unchanged and writes nothing', async () => {
    const { db, server } = await setup();
    server.put(newId(), D1, 'A');
    await run(db, server, D1);
    const second = await run(db, server, D1);
    expect(second).toMatchObject({ unchanged: true, pages: 0, written: 0 });
    expect(server.requests.at(-1)?.ifNoneMatch).toBe(`"${D1}:en:1"`);
  });

  it('updates the edited Place, removes the deactivated one, and leaves the rest', async () => {
    const { db, server } = await setup();
    const [a, b, c] = [newId(), newId(), newId()];
    server.put(a, D1, 'A');
    server.put(b, D1, 'B');
    server.put(c, D1, 'C');
    await run(db, server, D1);
    server.put(a, D1, 'A edited');
    server.put(b, D1, 'B', false);
    const result = await run(db, server, D1);
    expect(result).toMatchObject({ written: 1, removed: 1 });
    expect(await ids(db, D1)).toEqual([a, c].sort((x, y) => (x < y ? -1 : 1)));
    const [row] = await db.all<{ record_json: string }>(
      'SELECT record_json FROM place_records WHERE place_id = ?',
      [a],
    );
    expect(
      (JSON.parse(row!.record_json) as { localization: { name: string } }).localization.name,
    ).toBe('A edited');
  });

  it('advances only the cursor of an area whose own Places did not change', async () => {
    const { db, server } = await setup();
    server.put(newId(), D1, 'A');
    server.put(newId(), D4, 'B');
    await syncAreas({ db, client: server.client, areaIds: [D1, D4], lang: 'en', now: () => 1 });
    const before = await ids(db, D4);
    server.put(newId(), D1, 'new in D1'); // version moves for every area
    const result = await run(db, server, D4);
    expect(result).toMatchObject({ unchanged: false, written: 0, removed: 1 });
    expect(await cursorOf(db, D4, 'en')).toBe(3);
    expect(await ids(db, D4)).toEqual(before);
  });

  it('pages from the returned version until complete, one transaction per page', async () => {
    const { db, server } = await setup();
    server.pageSize = 2;
    for (let i = 0; i < 5; i += 1) server.put(newId(), D1, `P${i}`);
    const result = await run(db, server, D1);
    expect(result).toMatchObject({ pages: 3, written: 5, datasetVersion: 5 });
    expect(server.requests.map((r) => r.since)).toEqual([undefined, 2, 4]);
    expect((await ids(db, D1)).length).toBe(5);
  });

  it('is all or nothing: a malformed record leaves the database and cursor as they were', async () => {
    const { db, server } = await setup();
    server.put(newId(), D1, 'A');
    await run(db, server, D1);
    const before = await ids(db, D1);
    server.put(newId(), D1, 'B');
    server.put(newId(), D1, 'C');
    server.poisonNth = 2;
    await expect(run(db, server, D1)).rejects.toThrow();
    expect(await ids(db, D1)).toEqual(before);
    expect(await cursorOf(db, D1, 'en')).toBe(1);
  });

  it('keeps a mid-page failure from half-applying: the transaction rolls back', async () => {
    const { db, server } = await setup();
    server.put(newId(), D1, 'A');
    const failing: Database = {
      ...db,
      transaction: (fn) =>
        db.transaction(async (tx) => {
          const result = await fn({
            ...tx,
            run: async (sql, params) => {
              if (sql.includes('INSERT INTO sync_state')) throw new Error('disk full');
              await tx.run(sql, params);
            },
          });
          return result;
        }),
    };
    await expect(run(failing, server, D1)).rejects.toThrow('disk full');
    expect(await ids(db, D1)).toEqual([]);
    expect(await cursorOf(db, D1, 'en')).toBeNull();
  });

  it('refuses a page that does not advance', async () => {
    const { db, server } = await setup();
    server.put(newId(), D1, 'A');
    await run(db, server, D1);
    const stuck: SyncClient = {
      places: () =>
        Promise.resolve({ places: [], removedPlaceIds: [], datasetVersion: 1, complete: false }),
    };
    await expect(
      syncArea({ db, client: stuck, areaId: D1, lang: 'en', now: () => 1 }),
    ).rejects.toThrow('not advancing');
  });

  it('deletes a removed Place in every language, in this area only', async () => {
    const { db, server } = await setup();
    const a = newId();
    server.put(a, D1, 'A');
    await run(db, server, D1, 'en');
    await run(db, server, D1, 'vi');
    expect((await db.all('SELECT * FROM place_records')).length).toBe(2);
    server.put(a, D1, 'A', false);
    await run(db, server, D1, 'en');
    // the vi cursor is behind, but the removal in en already took every language of the area
    expect(await ids(db, D1)).toEqual([]);
  });
});

describe('removals are applied by area', () => {
  it('syncing D4 does not delete a D1 Place that changed', async () => {
    const { db, server } = await setup();
    const inD1 = newId();
    server.put(inD1, D1, 'A');
    server.put(newId(), D4, 'B');
    await syncAreas({ db, client: server.client, areaIds: [D1, D4], lang: 'en', now: () => 1 });
    server.put(inD1, D1, 'A edited'); // changed in D1: D4's response lists it as removed
    await run(db, server, D4);
    expect(await ids(db, D1)).toEqual([inD1]);
  });

  it.each([
    ['D1 first', [D1, D4]],
    ['D4 first', [D4, D1]],
  ])('a Place moved from D1 to D4 ends in D4 only (%s)', async (_label, order) => {
    const { db, server } = await setup();
    const moved = newId();
    server.put(moved, D1, 'Mover');
    server.put(newId(), D4, 'Stayer');
    await syncAreas({ db, client: server.client, areaIds: [D1, D4], lang: 'en', now: () => 1 });
    server.put(moved, D4, 'Mover'); // now in D4
    for (const areaId of order) await run(db, server, areaId);
    expect(await ids(db, D1)).toEqual([]);
    expect(await ids(db, D4)).toContain(moved);
    expect((await db.all('SELECT * FROM place_records WHERE place_id = ?', [moved])).length).toBe(
      1,
    );
  });

  it('ignores an id the device does not hold', async () => {
    const { db, server } = await setup();
    server.put(newId(), D1, 'A');
    await run(db, server, D1);
    server.put(newId(), D1, 'ghost', false);
    await expect(run(db, server, D1)).resolves.toMatchObject({ removed: 1 });
  });
});

describe('syncAreas', () => {
  it('drops the rows and cursor of an area that is no longer active', async () => {
    const { db, server } = await setup();
    server.put(newId(), D1, 'A');
    server.put(newId(), D4, 'B');
    await syncAreas({ db, client: server.client, areaIds: [D1, D4], lang: 'en', now: () => 1 });
    await syncAreas({ db, client: server.client, areaIds: [D1], lang: 'en', now: () => 2 });
    expect(await ids(db, D4)).toEqual([]);
    expect(await cursorOf(db, D4, 'en')).toBeNull();
    expect((await ids(db, D1)).length).toBe(1);
  });
});

describe('singleFlight', () => {
  it('gives a second caller the running promise and starts no second pass', async () => {
    let started = 0;
    let release: () => void = () => undefined;
    const task = singleFlight(() => {
      started += 1;
      return new Promise<number>((resolve) => {
        release = () => resolve(started);
      });
    });
    const first = task();
    const second = task();
    expect(second).toBe(first);
    release();
    expect(await first).toBe(1);
    const third = task(); // after it finished, a new pass starts
    release();
    expect(await third).toBe(2);
  });
});

describe('clearLocalData', () => {
  it('empties both tables', async () => {
    const { db, server } = await setup();
    server.put(newId(), D1, 'A');
    await run(db, server, D1);
    await clearLocalData(db);
    expect(await db.all('SELECT * FROM place_records')).toEqual([]);
    expect(await db.all('SELECT * FROM sync_state')).toEqual([]);
  });
});
