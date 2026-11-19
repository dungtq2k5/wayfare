import { beforeEach, describe, expect, it, vi } from 'vitest';

const order = vi.hoisted(() => [] as string[]);
const step = vi.hoisted(() => (name: string, value?: unknown) => () => {
  order.push(name);
  return value;
});
const forgetAnalytics = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../analytics/analytics', () => ({
  analytics: () => Promise.resolve({ forget: forgetAnalytics }),
}));
vi.mock('../data/audio-cache', () => ({ clearAudioCache: step('audio', Promise.resolve()) }));
vi.mock('../packs/controller', () => ({ forgetPacks: step('packs', Promise.resolve()) }));
vi.mock('../player/narration-player', () => ({ narrationPlayer: { stop: step('player') } }));
vi.mock('../sync/sync', () => ({ clearLocalData: step('places', Promise.resolve()) }));
vi.mock('../data/boot', () => ({ databaseReady: Promise.resolve({}) }));
vi.mock('../data/persister', () => ({
  persister: { removeClient: step('persisted queries', Promise.resolve()) },
}));
vi.mock('../walk/flags', () => ({ resetWalkFlags: step('walk flags') }));
vi.mock('../codes/flags', () => ({ resetCameraFlags: step('camera flags') }));
vi.mock('../data/heard', () => ({ clearHeard: step('heard') }));
vi.mock('../walk/log', () => ({ deleteWalkLog: step('walk log') }));
vi.mock('../walk/controller', () => ({ resetWalk: step('walk', Promise.resolve()) }));
vi.mock('../walk/geofence-places', () => ({ dropWalkPlaces: step('walk places') }));
vi.mock('../session', () => ({ accountSession: { end: step('session', Promise.resolve()) } }));
vi.mock('../session/account-store', () => ({ resetAccountState: step('account') }));
const stores = vi.hoisted(() => ({
  app: { setState: vi.fn() },
  network: { setState: vi.fn() },
  sync: { setState: vi.fn() },
  queries: { clear: vi.fn() },
}));
vi.mock('../state/app-store', () => ({ useAppStore: stores.app }));
vi.mock('../network/network-store', () => ({ useNetworkStore: stores.network }));
vi.mock('../sync/run-sync', () => ({ useSyncStore: stores.sync }));
vi.mock('../state/query-client', () => ({ queryClient: stores.queries }));

const { forgetLocalData } = await import('./forget');

describe('Forget this install', () => {
  beforeEach(() => {
    order.length = 0;
    vi.clearAllMocks();
  });

  it('stops the player and withdraws analytics first, then clears everything the install knew', async () => {
    await forgetLocalData();
    expect(forgetAnalytics).toHaveBeenCalled();
    expect(order[0]).toBe('player');
    expect(order.slice(1, 3)).toEqual(['session', 'account']);
    expect(order).toEqual(
      expect.arrayContaining(['walk', 'heard', 'audio', 'packs', 'places', 'persisted queries']),
    );
    expect(stores.queries.clear).toHaveBeenCalled();
    expect(stores.app.setState).toHaveBeenCalledWith({ currentAreaId: null });
    expect(stores.network.setState).toHaveBeenCalledWith({ status: 'unknown' });
    expect(stores.sync.setState).toHaveBeenCalledWith({ lastCheckedAt: null, error: null });
  });

  it('clears the install anyway when analytics can’t withdraw, or takes too long', async () => {
    forgetAnalytics.mockRejectedValueOnce(new Error('offline'));
    await forgetLocalData();
    expect(order).toContain('places');
    vi.useFakeTimers();
    try {
      order.length = 0;
      forgetAnalytics.mockReturnValueOnce(new Promise(() => undefined));
      const forgetting = forgetLocalData();
      await vi.advanceTimersByTimeAsync(5_000);
      await forgetting;
      expect(order).toContain('places');
    } finally {
      vi.useRealTimers();
    }
  });
});
