import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../state/app-store';
import { LOCAL_QUERY_KEY } from '../sync/run-sync';
import { databaseReady } from './boot';
import { areaSummaries, placesOfArea } from './queries';

/** Each synced area with its Place count: read from disk, never waiting on the network (ADR 0029). */
export function useLocalAreas() {
  const lang = useAppStore((state) => state.language) ?? 'en';
  return useQuery({
    queryKey: [...LOCAL_QUERY_KEY, 'areas', lang],
    queryFn: async () => areaSummaries(await databaseReady, lang),
    networkMode: 'always',
  });
}

/** One area's synced Places, from disk. */
export function useLocalPlaces(areaId: string) {
  const lang = useAppStore((state) => state.language) ?? 'en';
  return useQuery({
    queryKey: [...LOCAL_QUERY_KEY, 'places', areaId, lang],
    queryFn: async () => placesOfArea(await databaseReady, areaId, lang),
    networkMode: 'always',
  });
}
