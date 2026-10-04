import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeGateway } from './probe';
import type { ProbeDeps, ProbeLimits } from './probe';

const limits: ProbeLimits = { timeoutMs: 2_500, maxAttempts: 2, windowMs: 8_000 };

/** A fetch that never answers on its own but rejects when aborted. */
const hangs: ProbeDeps['fetch'] = (_url, { signal }) =>
  new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });

const clock = (): ProbeDeps['now'] => () => Date.now();

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('probeGateway', () => {
  it('is online when the gateway answers at once', async () => {
    const fetch = vi.fn(() => Promise.resolve({ status: 200 }));
    expect(await probeGateway('http://x/health', limits, { fetch, now: clock() })).toBe('online');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('counts any answer, even an error status, as online', async () => {
    const fetch = () => Promise.resolve({ status: 503 });
    expect(await probeGateway('http://x/health', limits, { fetch, now: clock() })).toBe('online');
  });

  it('is online when the first attempt times out and the second answers', async () => {
    let calls = 0;
    const fetch: ProbeDeps['fetch'] = (url, init) =>
      ++calls === 1 ? hangs(url, init) : Promise.resolve({ status: 200 });
    const verdict = probeGateway('http://x/health', limits, { fetch, now: clock() });
    await vi.advanceTimersByTimeAsync(2_500);
    expect(await verdict).toBe('online');
    expect(calls).toBe(2);
  });

  it('is offline when both attempts time out, within the window', async () => {
    const started = Date.now();
    const verdict = probeGateway('http://x/health', limits, { fetch: hangs, now: clock() });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await verdict).toBe('offline');
    expect(Date.now() - started).toBeLessThanOrEqual(8_000);
  });

  it('is offline at once when the network refuses', async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError('Network request failed')));
    expect(await probeGateway('http://x/health', limits, { fetch, now: clock() })).toBe('offline');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('starts no new attempt past the window', async () => {
    const fetch = vi.fn(hangs);
    const tight: ProbeLimits = { timeoutMs: 2_500, maxAttempts: 5, windowMs: 4_000 };
    const verdict = probeGateway('http://x/health', tight, { fetch, now: clock() });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await verdict).toBe('offline');
    expect(fetch).toHaveBeenCalledTimes(2); // 0 s and 2.5 s; the third would start at 5 s
  });
});
