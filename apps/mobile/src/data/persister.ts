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

/** Only `GET /areas` outlives the process: it names the areas to sync when the phone is offline. */
export const persistOptions = {
  persister,
  maxAge: PERSIST_MAX_AGE_MS,
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[0] === getAreasListQueryKey()[0],
  },
};
