import { clearAudioCache } from '../data/audio-cache';
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

/**
 * What *Forget this install* clears beyond the session: Places, cursors, cached areas, verdict, the
 * walk, the offline packs.
 */
export async function forgetLocalData(): Promise<void> {
  narrationPlayer.stop();
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
