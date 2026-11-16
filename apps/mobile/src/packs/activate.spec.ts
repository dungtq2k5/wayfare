import { newId } from '@wayfare/contracts';
import { gzipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate';
import { openTestDatabase } from '../db/test-database';
import { cursorOf } from '../sync/sync';
import { activateSnapshot, recordsOfSnapshot } from './activate';

const AREA = newId();
const OTHER = newId();

const record = (id: string, name: string, areaId = AREA) => ({
  id,
  kind: 'EDITORIAL',
  publicCode: 'ABCDEFGH',
  categoryCode: 'STREET_FOOD',
  areaId,
  location: { lat: 10.77, lng: 106.7 },
  triggerRadiusM: 40,
  narrationPriority: 0,
  autoNarrationEnabled: true,
  addressVi: null,
  localization: {
    lang: 'en',
    name,
    description: '',
    contentTier: 'REQUESTED',
    stale: false,
    audio: null,
    aFieldAddedLater: true,
  },
  cardPhoto: null,
  priceBand: null,
  openingHours: [],
});

const snapshot = (...records: object[]) =>
  gzipSync(strToU8(records.map((r) => `${JSON.stringify(r)}\n`).join('')));

async function setUp() {
  const db = openTestDatabase();
  await migrate(db);
  return db;
}

async function names(db: Awaited<ReturnType<typeof setUp>>, areaId = AREA) {
  const rows = await db.all<{ record_json: string }>(
    "SELECT record_json FROM place_records WHERE lang = 'en' AND area_id = ? ORDER BY place_id",
    [areaId],
  );
  return rows.map(
    (row) => (JSON.parse(row.record_json) as { localization: { name: string } }).localization.name,
  );
}

describe('the snapshot', () => {
  it('gunzips NDJSON and stores each record leniently', () => {
    const [stored] = recordsOfSnapshot(snapshot(record(newId(), 'Chợ Bến Thành')));
    expect(stored?.localization.name).toBe('Chợ Bến Thành');
    expect(stored?.localization).not.toHaveProperty('aFieldAddedLater');
  });
});

describe('activation', () => {
  it('a newer snapshot replaces the area’s rows in its language and raises the cursor', async () => {
    const db = await setUp();
    const [a, b, c] = [newId(), newId(), newId()];
    await activateSnapshot(db, {
      areaId: AREA,
      lang: 'en',
      datasetVersion: 10,
      records: recordsOfSnapshot(snapshot(record(a, 'A'), record(b, 'B'))),
      now: 1,
    });
    // Another area is not touched.
    await activateSnapshot(db, {
      areaId: OTHER,
      lang: 'en',
      datasetVersion: 10,
      records: recordsOfSnapshot(snapshot(record(c, 'Elsewhere', OTHER))),
      now: 1,
    });
    // B was removed on the server between 10 and 20: it must not linger.
    expect(
      await activateSnapshot(db, {
        areaId: AREA,
        lang: 'en',
        datasetVersion: 20,
        records: recordsOfSnapshot(snapshot(record(a, 'A2'))),
        now: 2,
      }),
    ).toBe('replaced');
    expect(await names(db)).toEqual(['A2']);
    expect(await names(db, OTHER)).toEqual(['Elsewhere']);
    expect(await cursorOf(db, AREA, 'en')).toBe(20);
    expect(await cursorOf(db, OTHER, 'en')).toBe(10);
  });

  it('an older or equal snapshot leaves the rows and the cursor alone', async () => {
    const db = await setUp();
    const a = newId();
    await activateSnapshot(db, {
      areaId: AREA,
      lang: 'en',
      datasetVersion: 30,
      records: recordsOfSnapshot(snapshot(record(a, 'Synced later'))),
      now: 1,
    });
    for (const version of [20, 30]) {
      expect(
        await activateSnapshot(db, {
          areaId: AREA,
          lang: 'en',
          datasetVersion: version,
          records: recordsOfSnapshot(snapshot(record(a, 'Older'))),
          now: 2,
        }),
      ).toBe('kept');
    }
    expect(await names(db)).toEqual(['Synced later']);
    expect(await cursorOf(db, AREA, 'en')).toBe(30);
  });
});
