// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeFake } from '../testing/react-native';
import { renderHook, settle } from '../testing/render-hook';
import type { Pack } from './db';
import type { PackFile } from './plan';

type Tap = (response: { notification: { request: { content: { data?: object } } } }) => void;
const native = vi.hoisted(() => ({
  network: [] as (() => void)[],
  taps: [] as Tap[],
  removed: 0,
  push: vi.fn((_route: object) => undefined),
}));
vi.mock('expo-network', () => ({
  addNetworkStateListener: (listener: () => void) => {
    native.network.push(listener);
    return { remove: () => (native.removed += 1) };
  },
}));
vi.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: (listener: Tap) => {
    native.taps.push(listener);
    return { remove: () => (native.removed += 1) };
  },
}));
vi.mock('expo-router', () => ({ router: { push: native.push } }));
vi.mock('../data/boot', () => ({ databaseReady: Promise.resolve({ db: true }) }));
const packs = vi.hoisted(() => ({
  checkNetwork: vi.fn(() => Promise.resolve('online')),
  checkPacks: vi.fn((_db: unknown, _sizeOf: (file: PackFile) => number | null) =>
    Promise.resolve(0),
  ),
  refreshPacks: vi.fn(() => Promise.resolve()),
  refreshPackIndex: vi.fn(() => Promise.resolve()),
  resumeDownloads: vi.fn(() => Promise.resolve()),
  checkUpdates: vi.fn(() => Promise.resolve()),
}));
vi.mock('../network/network-store', () => ({ checkNetwork: packs.checkNetwork }));
vi.mock('./damage', () => ({ checkPacks: packs.checkPacks }));
vi.mock('./use-pack-files', () => ({ refreshPackIndex: packs.refreshPackIndex }));
vi.mock('./controller', async () => {
  const { create: store } = await import('zustand');
  return {
    refreshPacks: packs.refreshPacks,
    resumeDownloads: packs.resumeDownloads,
    checkUpdates: packs.checkUpdates,
    usePackStore: store(() => ({ packs: [] as { state: string }[] })),
  };
});
vi.mock('./files', () => ({
  packFile: (_areaId: string, name: string) =>
    name === 'here' ? { exists: true, size: 7 } : { exists: false, size: 0 },
}));

const { usePackBoot, WAITING_PROBE_MS } = await import('./use-pack-boot');
const { usePackStore } = await import('./controller');

const mounted: { unmount(): void }[] = [];
const boot = async (enabled: boolean) => {
  const rendered = await renderHook(() => usePackBoot(enabled));
  mounted.push(rendered);
  return rendered;
};

describe('the packs at launch and after (K6, K7, K9, K16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.network = [];
    native.taps = [];
    native.removed = 0;
    packs.checkNetwork.mockResolvedValue('online');
  });
  afterEach(() => {
    vi.useRealTimers();
    for (const rendered of mounted.splice(0)) rendered.unmount();
  });

  it('does nothing until the database is ready', async () => {
    await boot(false);
    await settle();
    expect(packs.checkPacks).not.toHaveBeenCalled();
    expect(native.network).toEqual([]);
  });

  it('checks the packs by their files’ sizes, reads and indexes them, goes on, then asks for updates', async () => {
    await boot(true);
    await settle();
    const sizeOf = packs.checkPacks.mock.calls[0]![1];
    expect(sizeOf({ areaId: 'a', name: 'here' } as PackFile)).toBe(7);
    expect(sizeOf({ areaId: 'a', name: 'gone' } as PackFile)).toBeNull();
    expect(packs.refreshPacks).toHaveBeenCalled();
    expect(packs.refreshPackIndex).toHaveBeenCalled();
    expect(packs.resumeDownloads).toHaveBeenCalledTimes(2);
    expect(packs.checkUpdates).toHaveBeenCalled();
  });

  it('keeps going when one step fails, and asks for no update offline', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    packs.checkPacks.mockRejectedValueOnce(new Error('stat failed'));
    packs.checkNetwork.mockResolvedValue('offline');
    await boot(true);
    await settle();
    expect(warn).toHaveBeenCalledWith('Offline packs: check failed', expect.any(Error));
    expect(packs.refreshPacks).toHaveBeenCalled();
    expect(packs.checkUpdates).not.toHaveBeenCalled();
  });

  it('goes on when the network changes and when the app comes back', async () => {
    await boot(true);
    await settle();
    packs.resumeDownloads.mockClear();
    native.network[0]!();
    nativeFake.appState.emit('background');
    nativeFake.appState.emit('active');
    expect(packs.resumeDownloads).toHaveBeenCalledTimes(2);
  });

  it('asks the gateway again only while a download waits for a connection', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await boot(true);
    await settle();
    packs.checkNetwork.mockClear();
    vi.advanceTimersByTime(WAITING_PROBE_MS);
    expect(packs.checkNetwork).not.toHaveBeenCalled();
    usePackStore.setState({ packs: [{ state: 'waiting-connection' }] as Pack[] });
    vi.advanceTimersByTime(WAITING_PROBE_MS);
    expect(packs.checkNetwork).toHaveBeenCalledTimes(1);
  });

  it('opens the pack a notification names, and nothing for any other tap', async () => {
    await boot(true);
    const tap = native.taps[0]!;
    tap({
      notification: { request: { content: { data: { pack: { areaId: 'a1', lang: 'en' } } } } },
    });
    tap({ notification: { request: { content: {} } } });
    expect(native.push).toHaveBeenCalledTimes(1);
    expect(native.push).toHaveBeenCalledWith({
      pathname: '/settings/pack',
      params: { areaId: 'a1', lang: 'en' },
    });
  });

  it('stops listening when unmounted', async () => {
    const rendered = await renderHook(() => usePackBoot(true));
    const before = nativeFake.appState.size();
    rendered.unmount();
    expect(native.removed).toBe(2);
    expect(nativeFake.appState.size()).toBe(before - 1);
  });
});
