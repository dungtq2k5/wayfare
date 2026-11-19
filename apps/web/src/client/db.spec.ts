import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { database, readKv, writeKv } from './db';

describe('the browser’s database', () => {
  it('opens once, at version 3, with every store', async () => {
    const db = await database();
    expect(await database()).toBe(db);
    expect(db.version).toBe(3);
    expect([...db.objectStoreNames].sort((a, b) => a.localeCompare(b))).toEqual([
      'analytics',
      'device',
      'finished',
      'kv',
      'opened',
    ]);
  });

  it('keeps a per-browser value, and answers the fallback for one never set', async () => {
    await writeKv('saves', 3);
    expect(await readKv('saves', 0)).toBe(3);
    expect(await readKv('never', 'none')).toBe('none');
  });

  it('answers the fallback, and keeps nothing, when the database is unavailable', async () => {
    const db = await database();
    const get = vi.spyOn(db, 'get').mockRejectedValueOnce(new Error('private window'));
    const put = vi.spyOn(db, 'put').mockRejectedValueOnce(new Error('private window'));
    expect(await readKv('saves', 7)).toBe(7);
    await expect(writeKv('saves', 9)).resolves.toBeUndefined();
    expect(get).toHaveBeenCalled();
    expect(put).toHaveBeenCalled();
  });
});
