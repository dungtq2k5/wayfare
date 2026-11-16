import type { AnalyticsQueue, QueuedEvent } from '@wayfare/core';
import type { Queries } from '../db/database';

interface Row {
  id: string;
  analytics_device_id: string;
  body: string;
  recorded_at: number;
}

const toEvent = (row: Row): QueuedEvent => ({
  id: row.id,
  analyticsDeviceId: row.analytics_device_id,
  body: row.body,
  recordedAt: row.recorded_at,
});

/** The queue in the app's SQLite (migration 6): the oldest first, trimmed by age and count. */
export function sqliteQueue(db: () => Promise<Queries>): AnalyticsQueue {
  return {
    add: async (row) =>
      (await db()).run(
        'INSERT OR IGNORE INTO analytics_events (id, analytics_device_id, body, recorded_at) VALUES (?, ?, ?, ?)',
        [row.id, row.analyticsDeviceId, row.body, row.recordedAt],
      ),
    oldest: async (limit) =>
      (
        await (
          await db()
        ).all<Row>('SELECT * FROM analytics_events ORDER BY recorded_at, id LIMIT ?', [limit])
      ).map(toEvent),
    remove: async (ids) => {
      if (ids.length === 0) return;
      await (
        await db()
      ).run(`DELETE FROM analytics_events WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    },
    clear: async () => (await db()).run('DELETE FROM analytics_events'),
    count: async () => {
      const [row] = await (
        await db()
      ).all<{ n: number }>('SELECT count(*) AS n FROM analytics_events');
      return row?.n ?? 0;
    },
    trim: async (before, max) => {
      const queries = await db();
      await queries.run('DELETE FROM analytics_events WHERE recorded_at < ?', [before]);
      await queries.run(
        `DELETE FROM analytics_events WHERE id NOT IN (
           SELECT id FROM analytics_events ORDER BY recorded_at DESC, id DESC LIMIT ?)`,
        [max],
      );
    },
  };
}
