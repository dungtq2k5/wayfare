import { clearAudioCache } from '../player/audio-cache';
import { narrationPlayer } from '../player/narration-player';
import { clearLocalData } from '../sync/sync';
import { useNetworkStore } from '../network/network-store';
import { useSyncStore } from '../sync/run-sync';
import { useAppStore } from '../state/app-store';
import { queryClient } from '../state/query-client';
import { databaseReady } from './boot';
import { persister } from './persister';
import { resetWalkFlags } from '../walk/flags';
import { resetCameraFlags } from '../codes/flags';
import { clearHeard } from '../walk/heard';
import { deleteWalkLog } from '../walk/log';
import { resetWalk } from '../walk/controller';
import { dropWalkPlaces } from '../walk/geofence-places';

/** What *Forget this install* clears beyond the session: Places, cursors, cached areas, verdict, the walk. */
export async function forgetLocalData(): Promise<void> {
  narrationPlayer.stop();
  await resetWalk();
  clearHeard();
  resetWalkFlags();
  resetCameraFlags();
  deleteWalkLog();
  dropWalkPlaces();
  await clearAudioCache();
  await clearLocalData(await databaseReady);
  await persister.removeClient();
  queryClient.clear();
  useAppStore.setState({ currentAreaId: null });
  useNetworkStore.setState({ status: 'unknown' });
  useSyncStore.setState({ lastCheckedAt: null, error: null });
}
