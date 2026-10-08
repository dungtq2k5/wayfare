import { clearLocalData } from '../sync/sync';
import { useNetworkStore } from '../network/network-store';
import { useSyncStore } from '../sync/run-sync';
import { useAppStore } from '../state/app-store';
import { queryClient } from '../state/query-client';
import { databaseReady } from './boot';
import { persister } from './persister';

/** What *Forget this install* clears beyond the session: Places, cursors, cached areas, verdict. */
export async function forgetLocalData(): Promise<void> {
  await clearLocalData(await databaseReady);
  await persister.removeClient();
  queryClient.clear();
  useAppStore.setState({ currentAreaId: null });
  useNetworkStore.setState({ status: 'unknown' });
  useSyncStore.setState({ lastCheckedAt: null, error: null });
}
