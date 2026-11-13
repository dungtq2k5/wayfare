// nest-common's WorkQueue against a real Redis (conventions §11.3): no finished jobs kept, no
// retries of its own, and a re-add is never a silent no-op.
import { WorkQueue } from '@wayfare/nest-common';
import { afterEach, describe, expect, it } from 'vitest';
import { testConfig } from '../setup/database';

const redisUrl = testConfig().get('REDIS_URL', { infer: true });
let queue: WorkQueue<{ n: number }> | null = null;

afterEach(async () => {
  await queue?.drain();
  await queue?.close();
  queue = null;
});

const make = (concurrency = 1) => {
  queue = new WorkQueue<{ n: number }>({
    name: `narration-test-${Date.now()}`,
    redisUrl,
    concurrency,
  });
  return queue;
};

const until = async (condition: () => boolean, ms = 5_000) => {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe('WorkQueue', () => {
  it('runs an item, keeps nothing, and runs a re-add of the same id', async () => {
    const work = make();
    const seen: number[] = [];
    work.start(({ data }) => {
      seen.push(data.n);
      return Promise.resolve();
    });
    await work.add('a', { n: 1 });
    await until(() => seen.length === 1);
    // Completion removes the item a moment after the handler returns.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await work.has('a')).toBe(false);
    await work.add('a', { n: 2 });
    await until(() => seen.length === 2);
    expect(seen).toEqual([1, 2]);
  });

  it('never retries a failed item by itself', async () => {
    const work = make();
    let calls = 0;
    work.start(() => {
      calls++;
      return Promise.reject(new Error('boom'));
    });
    await work.add('b', { n: 1 });
    await until(() => calls === 1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(calls).toBe(1);
    expect(await work.has('b')).toBe(false);
  });

  it('removes a waiting item, and a remove of an absent one is harmless', async () => {
    const work = make();
    await work.add('c', { n: 1 }, { delayMs: 60_000 });
    expect(await work.has('c')).toBe(true);
    await work.remove('c');
    await work.remove('never-added');
    expect(await work.has('c')).toBe(false);
  });

  it('runs the lower priority first', async () => {
    const work = make();
    await work.add('late', { n: 9 }, { priority: 9 });
    await work.add('early', { n: 1 }, { priority: 1 });
    await work.add('middle', { n: 5 }, { priority: 5 });
    const seen: number[] = [];
    work.start(({ data }) => {
      seen.push(data.n);
      return Promise.resolve();
    });
    await until(() => seen.length === 3);
    expect(seen).toEqual([1, 5, 9]);
  });
});
