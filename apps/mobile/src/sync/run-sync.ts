import { getAreasListQueryOptions, syncPlaces } from '@wayfare/api-client';
import type { SyncPlaces200 } from '@wayfare/api-client';
import { create } from 'zustand';
import { databaseReady } from '../data/boot';
import { errorMessage } from '../i18n';
import { routeApiError } from '../state/api-errors';
import { useAppStore } from '../state/app-store';
import { queryClient } from '../state/query-client';
import { singleFlight, syncAreas } from './sync';
import type { SyncClient } from './sync';

interface SyncState {
  /** When a sync pass last finished, a `304` included; the cache TTL counts from here. */
  lastCheckedAt: number | null;
  syncing: boolean;
  error: string | null;
}

export const useSyncStore = create<SyncState>(() => ({
  lastCheckedAt: null,
  syncing: false,
  error: null,
}));

/** Every local query starts with this key, so a finished sync invalidates them all at once. */
export const LOCAL_QUERY_KEY = ['local'] as const;

const client: SyncClient = {
  async places({ areaId, lang, since, ifNoneMatch }) {
    const response = (await syncPlaces(
      { areaId, lang, ...(since === undefined ? {} : { since: String(since) }) },
      ifNoneMatch === undefined ? undefined : { headers: { 'If-None-Match': ifNoneMatch } },
    )) as SyncPlaces200 | undefined;
    if (response === undefined) return undefined;
    return {
      places: response.data.places,
      removedPlaceIds: response.data.removedPlaceIds,
      datasetVersion: response.data.datasetVersion,
      complete: response.meta.complete,
    };
  },
};

/** One sync of every active area; a call while one runs joins it. */
export const runSync = singleFlight(async () => {
  useSyncStore.setState({ syncing: true, error: null });
  try {
    const db = await databaseReady;
    const areas = await queryClient.fetchQuery({ ...getAreasListQueryOptions(), staleTime: 0 });
    const results = await syncAreas({
      db,
      client,
      areaIds: areas.data.map((area) => area.id),
      lang: useAppStore.getState().language ?? 'en',
      now: Date.now,
    });
    useSyncStore.setState({ lastCheckedAt: Date.now() });
    await queryClient.invalidateQueries({ queryKey: LOCAL_QUERY_KEY });
    return results;
  } catch (error) {
    routeApiError(error, useAppStore.getState());
    useSyncStore.setState({ error: errorMessage(error) });
    throw error;
  } finally {
    useSyncStore.setState({ syncing: false });
  }
});
