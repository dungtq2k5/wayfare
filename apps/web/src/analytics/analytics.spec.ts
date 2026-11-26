// @vitest-environment happy-dom
import type * as Core from '@wayfare/core';
import type { AnalyticsClient } from '@wayfare/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Deps = Parameters<typeof AnalyticsClient.open>[0];

const fake = vi.hoisted(() => ({
  client: {
    reload: vi.fn(() => Promise.resolve()),
    foreground: vi.fn(() => Promise.resolve()),
    flush: vi.fn(() => Promise.resolve()),
    record: vi.fn(() => Promise.resolve()),
  },
  open: vi.fn<(deps: Deps) => Promise<unknown>>(),
}));
vi.mock('@wayfare/core', async (importOriginal) => {
  const core = await importOriginal<typeof Core>();
  return { ...core, AnalyticsClient: { open: fake.open } };
});
vi.mock('@wayfare/api-client', () => ({ analyticsTransport: {} }));
const kv = vi.hoisted(() => ({
  stored: '',
  readKv: vi.fn(() => Promise.resolve(kv.stored)),
  writeKv: vi.fn(() => Promise.resolve()),
}));
vi.mock('../client/db', () => kv);
vi.mock('./queue', () => ({ idbQueue: {} }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('this browser’s analytics (ADR 0042)', () => {
  // The page's listeners and its five-minute timer live as long as the module: one clock for all.
  beforeAll(() => vi.useFakeTimers({ toFake: ['setInterval'] }));
  afterAll(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
    fake.open.mockResolvedValue(fake.client);
  });

  it('opens once, with its own stored state, in the page’s language', async () => {
    const { analytics } = await import('./analytics');
    const client = await analytics();
    expect(await analytics()).toBe(client);
    expect(fake.open).toHaveBeenCalledTimes(1);
    await flush();
    expect(fake.client.foreground).toHaveBeenCalledTimes(1);
    const deps = fake.open.mock.calls[0]![0];
    expect(await deps.load()).toBeNull();
    kv.stored = JSON.stringify({ consent: 'GRANTED' });
    expect(await deps.load()).toEqual({ consent: 'GRANTED' });
    await deps.save({ consent: 'DENIED' } as never);
    expect(kv.writeKv).toHaveBeenCalledWith('analytics', JSON.stringify({ consent: 'DENIED' }));
    expect(deps.language()).toBe('en');
    document.documentElement.lang = 'vi';
    expect(deps.language()).toBe('vi');
  });

  it('counts a visible page, sends when hidden, when online again, and every five minutes', async () => {
    const { analytics } = await import('./analytics');
    await analytics();
    setVisibility('visible');
    await flush();
    expect(fake.client.reload).toHaveBeenCalledTimes(1);
    expect(fake.client.foreground).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    await flush();
    expect(fake.client.foreground).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('pagehide'));
    expect(fake.client.flush).toHaveBeenLastCalledWith({ keepalive: true });
    window.dispatchEvent(new Event('online'));
    expect(fake.client.flush).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(fake.client.flush).toHaveBeenCalledTimes(2);
    setVisibility('visible');
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(fake.client.flush).toHaveBeenCalledTimes(3);
  });

  it('records an event, and never throws when it can’t', async () => {
    const { track } = await import('./analytics');
    track({ type: 'APP_OPENED' } as never);
    await flush();
    expect(fake.client.record).toHaveBeenCalledWith({ type: 'APP_OPENED' });
    fake.client.record.mockRejectedValueOnce(new Error('full'));
    track({ type: 'APP_OPENED' } as never);
    await flush();
  });

  it('carries on when a visible page’s reload fails', async () => {
    fake.client.reload.mockRejectedValueOnce(new Error('locked'));
    const { analytics } = await import('./analytics');
    await analytics();
    setVisibility('visible');
    await flush();
    expect(fake.client.reload).toHaveBeenCalled();
  });
});
