import { analytics } from '../analytics/analytics';
import { clearAudioCache } from '../data/audio-cache';

/** How long *Forget* waits for analytics' withdrawals before clearing regardless. */
const FORGET_ANALYTICS_WAIT_MS = 5_000;
import { forgetPacks } from '../packs/controller';
import { narrationPlayer } from '../player/narration-player';
import { clearLocalData } from '../sync/sync';
import { useNetworkStore } from '../network/network-store';
import { useSyncStore } from '../sync/run-sync';
import { useAppStore } from '../state/app-store';
import { queryClient } from '../state/query-client';
import { databaseReady } from '../data/boot';
import { persister } from '../data/persister';
import { resetWalkFlags } from '../walk/flags';
import { resetCameraFlags } from '../codes/flags';
import { clearHeard } from '../data/heard';
import { deleteWalkLog } from '../walk/log';
import { resetWalk } from '../walk/controller';
import { dropWalkPlaces } from '../walk/geofence-places';
import { accountSession } from '../session';
import { resetAccountState } from '../session/account-store';

/**
 * What *Forget this install* clears beyond the session: the account's session and what the phone
 * knew of it (a new install knows no account, K2), Places, cursors, cached areas, verdict, the
 * walk, the offline packs.
 */
export async function forgetLocalData(): Promise<void> {
  narrationPlayer.stop();
  // Analytics withdraws every id first, so the server deletes their raw events; offline, the install
  // is cleared anyway — the ids go with it, and the raw events, which name no one, age out.
  await Promise.race([
    analytics().then((client) => client.forget()),
    new Promise((resolve) => setTimeout(resolve, FORGET_ANALYTICS_WAIT_MS)),
  ]).catch(() => undefined);
  await accountSession.end();
  resetAccountState();
  await resetWalk();
  clearHeard();
  resetWalkFlags();
  resetCameraFlags();
  deleteWalkLog();
  dropWalkPlaces();
  await clearAudioCache();
  await forgetPacks();
  await clearLocalData(await databaseReady);
  await persister.removeClient();
  queryClient.clear();
  useAppStore.setState({ currentAreaId: null });
  useNetworkStore.setState({ status: 'unknown' });
  useSyncStore.setState({ lastCheckedAt: null, error: null });
}
