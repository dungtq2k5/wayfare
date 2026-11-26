import { describe, expect, it, vi } from 'vitest';
import { WorkQueue } from './work-queue';

/** BullMQ's queue and worker, recorded instead of reaching Redis. */
const bull = vi.hoisted(() => {
  const queues: FakeQueue[] = [];
  const workers: FakeWorker[] = [];
  class FakeQueue {
    readonly jobs = new Map<string, unknown>();
    add = vi.fn((_name: string, data: unknown, options: { jobId: string }) => {
      this.jobs.set(options.jobId, data);
      return Promise.resolve();
    });
    remove = vi.fn((id: string) => {
      if (id === 'running') return Promise.reject(new Error('locked'));
      this.jobs.delete(id);
      return Promise.resolve(1);
    });
    getJob = vi.fn((id: string) => Promise.resolve(this.jobs.has(id) ? { id } : undefined));
    close = vi.fn(() => Promise.resolve());
    obliterate = vi.fn(() => Promise.resolve());
    constructor(
      readonly name: string,
      readonly options: Record<string, unknown>,
    ) {
      queues.push(this);
    }
  }
  class FakeWorker {
    readonly listeners = new Map<string, (error: Error) => void>();
    close = vi.fn(() => Promise.resolve());
    constructor(
      readonly name: string,
      readonly process: (job: { id?: string; data: unknown }) => Promise<void>,
      readonly options: Record<string, unknown>,
    ) {
      workers.push(this);
    }
    on(event: string, listener: (error: Error) => void) {
      this.listeners.set(event, listener);
    }
  }
  return { queues, workers, FakeQueue, FakeWorker };
});
vi.mock('bullmq', () => ({ Queue: bull.FakeQueue, Worker: bull.FakeWorker }));

const build = () =>
  new WorkQueue<{ n: number }>({
    name: 'narration-tts',
    redisUrl: 'redis://localhost:6379/2',
    concurrency: 3,
  });

describe('a work queue (ADR 0019)', () => {
  it('keeps no finished items and never retries by itself', () => {
    build();
    expect(bull.queues.at(-1)!.options).toMatchObject({
      defaultJobOptions: { removeOnComplete: true, removeOnFail: true, attempts: 1 },
      connection: { db: 2, connectionName: 'narration-tts-queue' },
    });
  });

  it('replaces an item with the same id, passing a priority and delay only when given', async () => {
    const queue = build();
    const fake = bull.queues.at(-1)!;
    await queue.add('a', { n: 1 });
    await queue.add('a', { n: 2 }, { priority: 5, delayMs: 1_000 });
    expect(fake.remove).toHaveBeenCalledTimes(2);
    expect(fake.add.mock.calls.map(([, data, options]) => [data, options])).toEqual([
      [{ n: 1 }, { jobId: 'a' }],
      [{ n: 2 }, { jobId: 'a', priority: 5, delay: 1_000 }],
    ]);
    expect(await queue.has('a')).toBe(true);
    expect(await queue.has('b')).toBe(false);
  });

  it('leaves a running item alone when asked to remove it', async () => {
    const queue = build();
    await expect(queue.remove('running')).resolves.toBeUndefined();
    bull.queues.at(-1)!.remove.mockRejectedValueOnce('odd');
    await expect(queue.remove('odd')).resolves.toBeUndefined();
  });

  it('starts one worker at its concurrency, a failing handler only logged', async () => {
    const queue = build();
    const handler = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('tts down'));
    handler.mockRejectedValueOnce('odd');
    queue.start(handler);
    queue.start(handler);
    const worker = bull.workers.at(-1)!;
    expect(bull.workers.filter((w) => w.name === 'narration-tts')).toHaveLength(1);
    expect(worker.options).toMatchObject({
      concurrency: 3,
      connection: { connectionName: 'narration-tts-worker' },
    });
    for (let i = 0; i < 3; i++)
      await expect(worker.process({ id: 'a', data: { n: i } })).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledWith({ id: 'a', data: { n: 0 } });
    expect(() => worker.listeners.get('error')!(new Error('connection lost'))).not.toThrow();
  });

  it('closes its worker and queue, and drains everything for a test', async () => {
    const idle = build();
    await idle.close();
    expect(bull.queues.at(-1)!.close).toHaveBeenCalled();
    const queue = build();
    queue.start(() => Promise.resolve());
    await queue.close();
    await queue.drain();
    expect(bull.workers.at(-1)!.close).toHaveBeenCalled();
    expect(bull.queues.at(-1)!.obliterate).toHaveBeenCalledWith({ force: true });
  });
});
