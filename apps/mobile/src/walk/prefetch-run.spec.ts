import { NARRATION_CONFIG } from '@wayfare/contracts';
import { ApiError } from '@wayfare/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  narrationPrefetch: vi.fn((_body: { placeIds: string[]; lang: string }) => Promise.resolve({})),
}));
vi.mock('@wayfare/api-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
vi.mock('expo-sqlite/kv-store', () => ({
  default: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
}));
vi.mock('../state/app-store', async () => {
  const { create } = await import('zustand');
  return { useAppStore: create(() => ({ language: null as string | null })) };
});
vi.mock('../network/network-store', async () => {
  const { create } = await import('zustand');
  return { useNetworkStore: create(() => ({ status: 'online' })) };
});
const cache = vi.hoisted(() => ({
  kept: new Set<string>(),
  cachedFile: vi.fn((place: { id: string }) =>
    Promise.resolve(cache.kept.has(place.id) ? 'file://kept' : null),
  ),
  downloadToCache: vi.fn((_place: { id: string }) => Promise.resolve()),
}));
vi.mock('../data/audio-cache', () => cache);
vi.mock('../places/place-view', () => ({
  viewFromRecord: (record: { id: string }) => record,
  playerPlaceOf: (view: { id: string }) => ({ id: view.id }),
}));
const places = vi.hoisted(() => ({ records: new Map<string, unknown>() }));
vi.mock('./geofence-places', () => ({ walkPlaces: () => ({ records: places.records }) }));
vi.mock('../data/heard', async () => {
  const { create } = await import('zustand');
  return { useHeardStore: create(() => ({ ids: new Set<string>(['heard']) })) };
});

const { runPrefetch } = await import('./prefetch-run');
const { useNetworkStore } = await import('../network/network-store');
const { useAppStore } = await import('../state/app-store');

const here = { t: 0, lat: 10.7769, lng: 106.7009, accuracyM: 10 };
const record = (id: string, audio: object | null, dLat = 0.001) => ({
  id,
  location: { lat: here.lat + dLat, lng: here.lng },
  localization: { audio },
});
const MIN = NARRATION_CONFIG.prefetchMinIntervalMs;

/** Each test runs after the last one's floor, so the gate never carries over. */
let clock = 0;
const later = (ms = 0) => (clock += 10 * MIN + ms);

describe('warming the Places ahead of the walker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.kept = new Set();
    useNetworkStore.setState({ status: 'online' });
    useAppStore.setState({ language: 'ja' });
    places.records = new Map([
      ['silent', record('silent', null)],
      ['voiced', record('voiced', { url: 'a.mp3' })],
      ['heard', record('heard', null)],
      ['far', record('far', null, 1)],
    ]);
  });

  it('asks for the nearest unheard Places without audio, and downloads those with it', async () => {
    await runPrefetch(here, later());
    expect(api.narrationPrefetch).toHaveBeenCalledWith({ placeIds: ['silent'], lang: 'ja' });
    expect(cache.downloadToCache.mock.calls.map(([place]) => place.id)).toEqual(['voiced']);
  });

  it('keeps a file already in the cache, and carries on past a failed download', async () => {
    cache.kept = new Set(['voiced']);
    await runPrefetch(here, later());
    expect(cache.downloadToCache).not.toHaveBeenCalled();
    cache.kept = new Set();
    cache.downloadToCache.mockRejectedValueOnce(new Error('disk full'));
    await expect(runPrefetch(here, later())).resolves.toBeUndefined();
  });

  it('waits the floor between runs, and runs online only', async () => {
    const at = later();
    await runPrefetch(here, at);
    await runPrefetch(here, at + MIN - 1);
    expect(api.narrationPrefetch).toHaveBeenCalledTimes(1);
    useNetworkStore.setState({ status: 'offline' });
    await runPrefetch(here, later());
    expect(api.narrationPrefetch).toHaveBeenCalledTimes(1);
  });

  it('backs off longer at each 429 in a row, and only the floor after any other failure', async () => {
    const throttled = later();
    api.narrationPrefetch.mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'x'));
    await runPrefetch(here, throttled);
    // The second 429 in a row waits twice the floor.
    await runPrefetch(here, throttled + MIN);
    await runPrefetch(here, throttled + 2 * MIN);
    expect(api.narrationPrefetch).toHaveBeenCalledTimes(2);
    const failed = later();
    api.narrationPrefetch.mockReset();
    api.narrationPrefetch.mockRejectedValueOnce(new Error('offline'));
    await runPrefetch(here, failed);
    await runPrefetch(here, failed + MIN);
    expect(api.narrationPrefetch).toHaveBeenCalledTimes(2);
    api.narrationPrefetch.mockResolvedValue({});
  });

  it('asks in English before a language is chosen, and skips a Place with no audio left', async () => {
    useAppStore.setState({ language: null });
    places.records = new Map([['silent', record('silent', null)]]);
    await runPrefetch(here, later());
    expect(api.narrationPrefetch).toHaveBeenCalledWith({ placeIds: ['silent'], lang: 'en' });
    places.records = new Map([['voiced', record('voiced', { url: 'a.mp3' })]]);
    await runPrefetch(here, later());
    expect(cache.downloadToCache).toHaveBeenCalledTimes(1);
    expect(api.narrationPrefetch).toHaveBeenCalledTimes(1);
  });
});
