import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { getAreasListQueryKey } from '@wayfare/api-client';
import Storage from 'expo-sqlite/kv-store';
import { queryClient } from '../state/query-client';

/** How long a persisted answer may be restored. */
export const PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// A restored query is collected at once if its gcTime is shorter than its age.
queryClient.setQueryDefaults(getAreasListQueryKey(), { gcTime: PERSIST_MAX_AGE_MS });

/** The persister over the key-value store of expo-sqlite. */
export const persister = createAsyncStoragePersister({
  storage: Storage,
  key: 'wayfare.query-cache',
});

// The map's pack styles outlive the process too, for the same reason: the base map on a cold start.
queryClient.setQueryDefaults(['map-pack'], { gcTime: PERSIST_MAX_AGE_MS });

/**
 * Only `GET /areas` and the map-pack styles outlive the process: the areas to sync, and the base
 * map, when the phone is offline.
 */
export const persistOptions = {
  persister,
  maxAge: PERSIST_MAX_AGE_MS,
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[0] === getAreasListQueryKey()[0] || query.queryKey[0] === 'map-pack',
  },
};
