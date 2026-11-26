import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';

describe('the browser’s database, upgraded', () => {
  it('keeps a version 1 browser’s saves and adds the stores it lacked', async () => {
    const old = await openDB('wayfare', 1, {
      upgrade(db) {
        db.createObjectStore('device');
        db.createObjectStore('opened', { keyPath: 'code' }).createIndex('openedAt', 'openedAt');
        db.createObjectStore('kv');
      },
    });
    await old.put('kv', 4, 'saves');
    old.close();
    const { database, readKv } = await import('./db');
    expect([...(await database()).objectStoreNames]).toContain('analytics');
    expect(await readKv('saves', 0)).toBe(4);
  });
});
