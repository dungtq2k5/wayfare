import { NARRATION_CONFIG } from '@wayfare/contracts';
import * as Network from 'expo-network';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { checkNetwork } from '../network/network-store';
import { runSync, useSyncStore } from '../sync/run-sync';

/** Probe the gateway, and sync if it answers. A failed sync is recorded in the sync store. */
async function probeAndSync(): Promise<void> {
  if ((await checkNetwork()) === 'online') await runSync().catch(() => undefined);
}

/**
 * When the phone syncs: once at start and whenever the install becomes registered, on
 * returning to the app after the cache TTL, and when connectivity comes back — each time after
 * the probe has said the gateway answers. Never from the background location task.
 */
export function useDataBoot(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    void probeAndSync();
    const appState = AppState.addEventListener('change', (state) => {
      const last = useSyncStore.getState().lastCheckedAt;
      if (
        state === 'active' &&
        (last === null || Date.now() - last > NARRATION_CONFIG.placeCacheTtlMs)
      ) {
        void probeAndSync();
      }
    });
    // The OS flag only says "something changed": the probe decides whether the gateway answers.
    const connectivity = Network.addNetworkStateListener((state) => {
      if (state.isConnected === true) void probeAndSync();
    });
    return () => {
      appState.remove();
      connectivity.remove();
    };
  }, [enabled]);
}
