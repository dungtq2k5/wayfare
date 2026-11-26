import { describe, expect, it, vi } from 'vitest';
import type { Queries } from '../db/database';
import { sqliteQueue } from './queue';

/** The app's SQLite as the queue calls it: each statement recorded, `all` answering `rows`. */
function fakeDb(rows: unknown[] = []) {
  const run = vi.fn((_sql: string, _params?: unknown[]) => Promise.resolve());
  const all = vi.fn((_sql: string, _params?: unknown[]) => Promise.resolve(rows));
  return { db: { run, all } as unknown as Queries, run, all };
}

describe('analytics’ queue in the app’s SQLite (migration 6)', () => {
  it('adds an event once, by its id', async () => {
    const { db, run } = fakeDb();
    await sqliteQueue(() => Promise.resolve(db)).add({
      id: 'e1',
      analyticsDeviceId: 'ad1',
      body: '{}',
      recordedAt: 10,
    });
    expect(run.mock.calls[0]![0]).toMatch(/^INSERT OR IGNORE INTO analytics_events/);
    expect(run.mock.calls[0]![1]).toEqual(['e1', 'ad1', '{}', 10]);
  });

  it('hands back the oldest first, up to the limit, as events', async () => {
    const { db, all } = fakeDb([
      { id: 'e1', analytics_device_id: 'ad1', body: '{}', recorded_at: 5 },
    ]);
    const oldest = await sqliteQueue(() => Promise.resolve(db)).oldest(50);
    expect(all.mock.calls[0]![0]).toMatch(/ORDER BY recorded_at, id LIMIT \?/);
    expect(all.mock.calls[0]![1]).toEqual([50]);
    expect(oldest).toEqual([{ id: 'e1', analyticsDeviceId: 'ad1', body: '{}', recordedAt: 5 }]);
  });

  it('removes what was sent, one placeholder per id, and asks nothing for none', async () => {
    const { db, run } = fakeDb();
    const queue = sqliteQueue(() => Promise.resolve(db));
    await queue.remove([]);
    expect(run).not.toHaveBeenCalled();
    await queue.remove(['a', 'b']);
    expect(run).toHaveBeenCalledWith('DELETE FROM analytics_events WHERE id IN (?,?)', ['a', 'b']);
  });

  it('counts the queue, zero when the count is empty, and clears it', async () => {
    const counted = fakeDb([{ n: 7 }]);
    expect(await sqliteQueue(() => Promise.resolve(counted.db)).count()).toBe(7);
    const empty = fakeDb([]);
    const queue = sqliteQueue(() => Promise.resolve(empty.db));
    expect(await queue.count()).toBe(0);
    await queue.clear();
    expect(empty.run).toHaveBeenCalledWith('DELETE FROM analytics_events');
  });

  it('trims by age, then keeps only the newest past the cap', async () => {
    const { db, run } = fakeDb();
    await sqliteQueue(() => Promise.resolve(db)).trim(100, 5_000);
    expect(run.mock.calls[0]).toEqual([
      'DELETE FROM analytics_events WHERE recorded_at < ?',
      [100],
    ]);
    expect(run.mock.calls[1]![0]).toMatch(/ORDER BY recorded_at DESC, id DESC LIMIT \?/);
    expect(run.mock.calls[1]![1]).toEqual([5_000]);
  });
});
