'use client';

import type { AnalyticsQueue } from '@wayfare/core';
import { database } from '../client/db';

/** The queue in the browser's IndexedDB (version 3's `analytics`): oldest first, trimmed by age and count. */
export const idbQueue: AnalyticsQueue = {
  add: async (row) => {
    await (await database()).put('analytics', row);
  },
  oldest: async (limit) => {
    const rows = [];
    let cursor = await (
      await database()
    )
      .transaction('analytics')
      .store.index('recordedAt')
      .openCursor();
    while (cursor !== null && rows.length < limit) {
      rows.push(cursor.value);
      cursor = await cursor.continue();
    }
    return rows;
  },
  remove: async (ids) => {
    const tx = (await database()).transaction('analytics', 'readwrite');
    await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
  },
  clear: async () => {
    await (await database()).clear('analytics');
  },
  count: async () => (await database()).count('analytics'),
  trim: async (before, max) => {
    const tx = (await database()).transaction('analytics', 'readwrite');
    const index = tx.store.index('recordedAt');
    let old = await index.openCursor(IDBKeyRange.upperBound(before, true));
    while (old !== null) {
      await old.delete();
      old = await old.continue();
    }
    let extra = (await tx.store.count()) - max;
    let oldest = extra > 0 ? await index.openCursor() : null;
    while (oldest !== null && extra > 0) {
      await oldest.delete();
      extra -= 1;
      oldest = await oldest.continue();
    }
    await tx.done;
  },
};
