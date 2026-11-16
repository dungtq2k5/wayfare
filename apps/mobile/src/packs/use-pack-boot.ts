import * as Network from 'expo-network';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { databaseReady } from '../data/boot';
import { checkNetwork } from '../network/network-store';
import { checkUpdates, refreshPacks, resumeDownloads, usePackStore } from './controller';
import { checkPacks } from './damage';
import { packFile } from './files';
import { refreshPackIndex } from './use-pack-files';

/** While a download waits for a connection with the app open, the gateway is asked this often (K6). */
export const WAITING_PROBE_MS = 30_000;

async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.warn(`Offline packs: ${name} failed`, error);
  }
}

/** Online: downloads go on, and ready packs ask for their updates. */
async function whenOnline(): Promise<void> {
  if ((await checkNetwork()) !== 'online') return;
  await resumeDownloads();
  await checkUpdates();
}

/**
 * Mount once, in the root layout, after the database is migrated: the packs in use are checked
 * (K16) and indexed, a download a kill interrupted goes on (K9), and from then on the network and
 * the app's return move downloads by themselves (K6, K7).
 */
export function usePackBoot(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      // Each step on its own: one failing (a file the system will not stat) must not leave the
      // packs unread, or every screen would show nothing downloaded.
      await step('check', async () =>
        checkPacks(await databaseReady, (file) => {
          const onDisk = packFile(file.areaId, file.name);
          return onDisk.exists ? onDisk.size : null;
        }),
      );
      await step('read', refreshPacks);
      await step('index', refreshPackIndex);
      await step('resume', resumeDownloads);
      await step('online', whenOnline);
    })();
    // Wi-Fi up but reaching nothing fires no event: a download waiting for a connection asks again.
    const probe = setInterval(() => {
      const waiting = usePackStore
        .getState()
        .packs.some((pack) => pack.state === 'waiting-connection');
      if (waiting) void whenOnline();
    }, WAITING_PROBE_MS);
    const network = Network.addNetworkStateListener(() => void resumeDownloads());
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void resumeDownloads();
    });
    // N1's tap opens the pack.
    const taps = Notifications.addNotificationResponseReceivedListener((response) => {
      const pack = response.notification.request.content.data?.pack as
        { areaId: string; lang: string } | undefined;
      if (pack !== undefined) {
        router.push({ pathname: '/settings/pack', params: pack });
      }
    });
    return () => {
      clearInterval(probe);
      network.remove();
      appState.remove();
      taps.remove();
    };
  }, [enabled]);
}
