import { describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate';
import { openTestDatabase } from '../db/test-database';
import { clearLocalData } from '../sync/sync';
import { initialWalk } from './machine';
import { heardPlaceIds, loadWalk, recordHeard, saveWalk } from './records';

async function database() {
  const db = openTestDatabase();
  await migrate(db);
  return db;
}

describe('heard', () => {
  it('records a Place once, keeping when it was first heard', async () => {
    const db = await database();
    await recordHeard(db, 'a', 10);
    await recordHeard(db, 'a', 99);
    await recordHeard(db, 'b', 50);
    expect((await heardPlaceIds(db)).sort((a, b) => a.localeCompare(b))).toEqual(['a', 'b']);
    expect(
      await db.all('SELECT first_heard_at, last_heard_at FROM heard_places WHERE place_id = ?', [
        'a',
      ]),
    ).toEqual([{ first_heard_at: 10, last_heard_at: 99 }]);
  });

  it('is cleared, with the walk, by forgetting local data', async () => {
    const db = await database();
    await recordHeard(db, 'a', 1);
    await saveWalk(db, { ...initialWalk(), phase: 'on', startedAt: 1 });
    await clearLocalData(db);
    expect(await heardPlaceIds(db)).toEqual([]);
    expect((await loadWalk(db)).phase).toBe('off');
  });
});

describe('the walk record', () => {
  it('round-trips, replacing the previous one', async () => {
    const db = await database();
    await saveWalk(db, { ...initialWalk(), phase: 'on', startedAt: 5, heard: ['a'] });
    await saveWalk(db, { ...initialWalk(), phase: 'ended', endReason: 'idle' });
    expect(await loadWalk(db)).toMatchObject({ phase: 'ended', endReason: 'idle' });
    expect(await db.all('SELECT id FROM walk_record')).toHaveLength(1);
  });

  it('reads an unreadable record as no walk', async () => {
    const db = await database();
    await db.run("INSERT INTO walk_record VALUES (1, 'not json')");
    expect(await loadWalk(db)).toEqual(initialWalk());
  });
});
