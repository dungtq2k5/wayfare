// @vitest-environment happy-dom
import { NARRATION_CONFIG } from '@wayfare/contracts';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeFake } from '../testing/react-native';
import { renderHook, settle } from '../testing/render-hook';

const network = vi.hoisted(() => {
  const listeners = new Set<(state: { isConnected: boolean | null }) => void>();
  return {
    listeners,
    addNetworkStateListener: (listener: (state: { isConnected: boolean | null }) => void) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
});
vi.mock('expo-network', () => network);
const lane = vi.hoisted(() => ({
  verdict: 'online',
  checkNetwork: vi.fn(() => Promise.resolve(lane.verdict)),
  resumeSwitch: vi.fn(),
  runSync: vi.fn(() => Promise.resolve()),
  lastCheckedAt: null as number | null,
}));
vi.mock('../network/network-store', () => ({ checkNetwork: lane.checkNetwork }));
vi.mock('../language/switch', () => ({ resumeSwitch: lane.resumeSwitch }));
vi.mock('../sync/run-sync', () => ({
  runSync: lane.runSync,
  useSyncStore: { getState: () => ({ lastCheckedAt: lane.lastCheckedAt }) },
}));

const { useDataBoot } = await import('./use-data-boot');

describe('when the phone syncs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lane.verdict = 'online';
    lane.lastCheckedAt = null;
  });

  it('never before the install is registered', async () => {
    await renderHook(() => useDataBoot(false));
    await settle();
    expect(lane.checkNetwork).not.toHaveBeenCalled();
  });

  it('at start, once the probe says the gateway answers, resuming a waiting switch', async () => {
    const rendered = await renderHook(() => useDataBoot(true));
    await settle();
    expect(lane.resumeSwitch).toHaveBeenCalled();
    expect(lane.runSync).toHaveBeenCalledTimes(1);
    rendered.unmount();
    expect(network.listeners.size).toBe(0);
    expect(nativeFake.appState.size()).toBe(0);
  });

  it('not while the gateway doesn’t answer, and a failed sync stays the sync store’s', async () => {
    lane.verdict = 'offline';
    const offline = await renderHook(() => useDataBoot(true));
    await settle();
    expect(lane.runSync).not.toHaveBeenCalled();
    offline.unmount();
    lane.verdict = 'online';
    lane.runSync.mockRejectedValueOnce(new Error('down'));
    const failing = await renderHook(() => useDataBoot(true));
    await settle();
    failing.unmount();
  });

  it('on returning to the app after the cache’s lifetime, not before', async () => {
    const rendered = await renderHook(() => useDataBoot(true));
    await settle();
    lane.lastCheckedAt = Date.now();
    act(() => nativeFake.appState.emit('active'));
    await settle();
    expect(lane.checkNetwork).toHaveBeenCalledTimes(1);
    lane.lastCheckedAt = Date.now() - NARRATION_CONFIG.placeCacheTtlMs - 1;
    act(() => nativeFake.appState.emit('background'));
    act(() => nativeFake.appState.emit('active'));
    await settle();
    expect(lane.checkNetwork).toHaveBeenCalledTimes(2);
    lane.lastCheckedAt = null;
    act(() => nativeFake.appState.emit('active'));
    await settle();
    expect(lane.checkNetwork).toHaveBeenCalledTimes(3);
    rendered.unmount();
  });

  it('when connectivity comes back, the probe deciding', async () => {
    const rendered = await renderHook(() => useDataBoot(true));
    await settle();
    act(() => network.listeners.forEach((listener) => listener({ isConnected: false })));
    act(() => network.listeners.forEach((listener) => listener({ isConnected: true })));
    await settle();
    expect(lane.checkNetwork).toHaveBeenCalledTimes(2);
    rendered.unmount();
  });
});
