import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { idbQueue } from './queue';

const row = (id: string, recordedAt: number) => ({
  id,
  analyticsDeviceId: 'ad1',
  body: '{}',
  recordedAt,
});

describe('analytics’ queue in IndexedDB', () => {
  it('hands back the oldest first, up to the limit, and removes what was sent', async () => {
    await idbQueue.clear();
    await idbQueue.add(row('c', 30));
    await idbQueue.add(row('a', 10));
    await idbQueue.add(row('b', 20));
    expect((await idbQueue.oldest(2)).map((r) => r.id)).toEqual(['a', 'b']);
    await idbQueue.remove(['a', 'b']);
    expect(await idbQueue.count()).toBe(1);
  });

  it('trims what is older than the cut, then the oldest past the cap', async () => {
    await idbQueue.clear();
    for (const [id, at] of [
      ['old1', 1],
      ['old2', 2],
      ['k1', 10],
      ['k2', 11],
      ['k3', 12],
      ['k4', 13],
    ] as const)
      await idbQueue.add(row(id, at));
    await idbQueue.trim(10, 3);
    expect((await idbQueue.oldest(10)).map((r) => r.id)).toEqual(['k2', 'k3', 'k4']);
  });

  it('trims nothing past the cap when under it', async () => {
    await idbQueue.clear();
    await idbQueue.add(row('only', 50));
    await idbQueue.trim(0, 10);
    expect(await idbQueue.count()).toBe(1);
  });
});
