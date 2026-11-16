import { ApiError, usePlacesGet } from '@wayfare/api-client';
import { useLocalPlace } from '../data/hooks';
import { useNetworkStore } from '../network/network-store';
import { useAppStore } from '../state/app-store';
import { viewFromDetail, viewFromRecord } from './place-view';
import type { PlaceView } from './place-view';

export type PlaceViewState =
  | { kind: 'loading' }
  /** The gateway says the Place is gone from Wayfare. */
  | { kind: 'removed' }
  | { kind: 'error'; retry: () => void }
  | { kind: 'ready'; view: PlaceView };

/** The Place's detail: online from the gateway, otherwise the synced record alone. */
export function usePlaceView(placeId: string): PlaceViewState {
  const lang = useAppStore((state) => state.language) ?? 'en';
  const offline = useNetworkStore((state) => state.status === 'offline');
  const online = usePlacesGet(placeId, { lang }, { query: { enabled: !offline, retry: false } });
  const local = useLocalPlace(placeId);

  const removed =
    online.error instanceof ApiError &&
    (online.error.code === 'PLACE_UNAVAILABLE' || online.error.code === 'RESOURCE_NOT_FOUND');
  if (removed) return { kind: 'removed' };
  if (online.data !== undefined && !offline) {
    return { kind: 'ready', view: viewFromDetail(online.data.data) };
  }
  // Offline, or the gateway did not answer: what the phone synced.
  if (offline || online.isError) {
    if (local.data) return { kind: 'ready', view: viewFromRecord(local.data) };
    if (local.isPending) return { kind: 'loading' };
    return { kind: 'error', retry: () => void online.refetch() };
  }
  return { kind: 'loading' };
}
