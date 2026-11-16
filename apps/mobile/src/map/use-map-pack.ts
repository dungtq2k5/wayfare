import { useQuery } from '@tanstack/react-query';
import { offlineManifest } from '@wayfare/api-client';
import type { AreaResponseDto } from '@wayfare/api-client';
import { PERSIST_MAX_AGE_MS } from '../data/persister';
import { useAppStore } from '../state/app-store';
import type { PackStyles } from './map-logic';

/** The key every persisted map-pack answer starts with. */
export const MAP_PACK_QUERY_KEY = 'map-pack'; // also named in data/persister.ts

/**
 * The styles of an area's published pack, from its offline manifest : read once per pack
 * version, kept with the cached areas, so the base map is known on an offline cold start. A new
 * pack version (from `GET /areas`) is a new key, and so a new read.
 */
export function useMapPack(area: AreaResponseDto | undefined) {
  const lang = useAppStore((state) => state.language) ?? 'en';
  const version = area?.mapPack?.version ?? 0;
  return useQuery({
    queryKey: [MAP_PACK_QUERY_KEY, area?.id ?? null, version],
    enabled: area !== undefined && area.mapPack !== null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: PERSIST_MAX_AGE_MS,
    queryFn: async (): Promise<PackStyles | null> => {
      const { data } = await offlineManifest(area!.id, { lang });
      const pack = data.mapPack;
      return pack === null
        ? null
        : { version: pack.version, style: pack.style.url, styleDark: pack.styleDark?.url ?? null };
    },
  });
}
