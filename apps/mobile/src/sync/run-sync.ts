import { getAreasListQueryOptions, syncPlaces } from '@wayfare/api-client';
import type { Language } from '@wayfare/contracts';
import type { SyncPlaces200 } from '@wayfare/api-client';
import { create } from 'zustand';
import { databaseReady } from '../data/boot';
import { LOCAL_QUERY_KEY } from '../data/hooks';
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

/**
 * One sync of every active area in a language (the current one by default); a call while one runs
 * for the same language joins it. A switch syncs its new language beside the current one's rows,
 * and only the current language's sync shows in the sync store.
 */
export const runSync = (lang?: Language) =>
  syncByLanguage(lang ?? useAppStore.getState().language ?? 'en');

const syncByLanguage = singleFlight(async (lang: Language) => {
  const current = lang === (useAppStore.getState().language ?? 'en');
  if (current) useSyncStore.setState({ syncing: true, error: null });
  try {
    const db = await databaseReady;
    const areas = await queryClient.fetchQuery({ ...getAreasListQueryOptions(), staleTime: 0 });
    const results = await syncAreas({
      db,
      client,
      areaIds: areas.data.map((area) => area.id),
      lang,
      now: Date.now,
    });
    if (current) useSyncStore.setState({ lastCheckedAt: Date.now() });
    await queryClient.invalidateQueries({ queryKey: LOCAL_QUERY_KEY });
    return results;
  } catch (error) {
    routeApiError(error, useAppStore.getState());
    if (current) useSyncStore.setState({ error: errorMessage(error) });
    throw error;
  } finally {
    if (current) useSyncStore.setState({ syncing: false });
  }
});
