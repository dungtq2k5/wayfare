import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { offlineManifest } from '@wayfare/api-client';
import { databaseReady } from '../data/boot';
import { useLocalPlaces } from '../data/hooks';
import { usePackStore } from './controller';
import { filesOfPack, USED_STATES } from './db';
import type { FileKind, PackFile } from './plan';
import { FILE_KINDS, filesOf } from './plan';

/** One part of a pack, as the sheet and the pack screen list it: all of it, and what is still to fetch. */
export interface PartSize {
  readonly total: number;
  readonly needed: number;
}

export interface PackPlan {
  readonly parts: Readonly<Record<FileKind, PartSize>>;
  readonly total: number;
  /** What a download would fetch: files already verified on the phone are not fetched again. */
  readonly needed: number;
  readonly hasMap: boolean;
}

const keyOf = (file: PackFile) => `${file.lang}|${file.kind}|${file.name}`;

/** Sizes by part, from a manifest's files and those the phone already holds (K3, K18). */
export function planOf(files: readonly PackFile[], held: readonly PackFile[]): PackPlan {
  const verified = new Set(held.filter((file) => file.verified).map(keyOf));
  const parts = Object.fromEntries(
    FILE_KINDS.map((kind) => {
      const ofKind = files.filter((file) => file.kind === kind);
      return [
        kind,
        {
          total: ofKind.reduce((sum, file) => sum + file.bytes, 0),
          needed: ofKind
            .filter((file) => !verified.has(keyOf(file)))
            .reduce((sum, file) => sum + file.bytes, 0),
        },
      ];
    }),
  ) as Record<FileKind, PartSize>;
  const total = FILE_KINDS.reduce((sum, kind) => sum + parts[kind].total, 0);
  const needed = FILE_KINDS.reduce((sum, kind) => sum + parts[kind].needed, 0);
  return { parts, total, needed, hasMap: parts.map.total > 0 };
}

/** The area's pack in `lang` before it is downloaded: its manifest against what the phone holds. */
export function usePackPlan(areaId: string | null, lang: string) {
  // The packs' rows change as files arrive: the plan follows them.
  const packs = usePackStore((state) => state.packs);
  return useQuery({
    queryKey: ['pack-plan', areaId, lang, packs],
    enabled: areaId !== null,
    staleTime: 5 * 60_000,
    // A new key on every pack refresh: the last answer stays on screen while it is asked again.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<PackPlan> => {
      const { data } = await offlineManifest(areaId!, { lang });
      const held = await filesOfPack(await databaseReady, areaId!, lang);
      return planOf(filesOf(data).files, held);
    },
  });
}

/** A downloaded pack's own parts, from its rows (frame M2's "In this download"). */
export function useHeldPlan(areaId: string, lang: string) {
  const packs = usePackStore((state) => state.packs);
  return useQuery({
    queryKey: ['pack-held', areaId, lang, packs],
    networkMode: 'always',
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const held = await filesOfPack(await databaseReady, areaId, lang);
      return planOf(held, held);
    },
  });
}

/** What the area's Places hold in the app's language: places, photos, stories and their listening time. */
export function usePackCounts(areaId: string | null) {
  const records = useLocalPlaces(areaId ?? '').data ?? [];
  const stories = records.filter((record) => record.localization.audio != null);
  return {
    places: records.length,
    photos: records.filter((record) => record.cardPhoto != null).length,
    stories: stories.length,
    listeningMs: stories.reduce(
      (sum, record) => sum + (record.localization.audio?.durationMs ?? 0),
      0,
    ),
  };
}

/** What the downloads hold on the phone: the areas in use and their bytes, each file once. */
export function usePackUsage() {
  const packs = usePackStore((state) => state.packs);
  const bytes = usePackStore((state) => state.usedBytes);
  const areas = new Set(
    packs.filter((pack) => USED_STATES.includes(pack.state)).map((pack) => pack.areaId),
  );
  return { areas: areas.size, bytes };
}
