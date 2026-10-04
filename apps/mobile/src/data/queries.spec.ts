import { newId } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate';
import { openTestDatabase } from '../db/test-database';
import { areaSummaries, placesOfArea } from './queries';

describe('local queries', () => {
  it('counts an area’s Places and returns their records', async () => {
    const db = openTestDatabase();
    await migrate(db);
    const area = newId();
    const place = newId();
    await db.run('INSERT INTO place_records VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      place,
      'en',
      area,
      'EDITORIAL',
      'CAFE',
      1,
      2,
      JSON.stringify({ id: place }),
    ]);
    await db.run('INSERT INTO sync_state VALUES (?, ?, ?, ?)', [area, 'en', 9, 5]);
    await db.run('INSERT INTO sync_state VALUES (?, ?, ?, ?)', [area, 'vi', 3, 5]);
    expect(await areaSummaries(db, 'en')).toEqual([
      { areaId: area, places: 1, datasetVersion: 9, syncedAt: 5 },
    ]);
    expect(await areaSummaries(db, 'vi')).toMatchObject([{ places: 0 }]);
    expect(await placesOfArea(db, area, 'en')).toEqual([{ id: place }]);
    expect(await placesOfArea(db, area, 'vi')).toEqual([]);
  });
});
