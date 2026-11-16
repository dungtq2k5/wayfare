import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { databaseReady } from '../data/boot';
import { LOCAL_QUERY_KEY } from '../data/hooks';
import { allPlaces } from '../data/queries';
import { useAppStore } from '../state/app-store';
import { useFinishedStore } from './finished';
import { finishedStories, localTour, progressOf, tourRecords, tourStart } from './tour-records';
import type { LocalTour, TourStart } from './tour-records';

/** A tour with where it stands on this phone. */
export interface TourWithProgress {
  readonly tour: LocalTour;
  readonly start: TourStart | null;
  readonly progress: ReturnType<typeof progressOf>;
}

async function load(lang: Parameters<typeof tourRecords>[1], areaId?: string, tourId?: string) {
  const db = await databaseReady;
  const [records, places, finished] = await Promise.all([
    tourRecords(db, lang, areaId),
    allPlaces(db, lang),
    finishedStories(db),
  ]);
  const byId = new Map(places.map((place) => [place.id, place]));
  const out: TourWithProgress[] = [];
  for (const record of records) {
    if (tourId !== undefined && record.id !== tourId) continue;
    const tour = localTour(record, byId);
    const start = await tourStart(db, record.id);
    out.push({ tour, start, progress: progressOf(tour, finished, start) });
  }
  return out;
}

/**
 * An area's tours on this phone (TM1): only those a tourist sees — two live stops at least, by the
 * phone's own Places (K7) — with each one's progress.
 */
export function useLocalTours(areaId: string | null) {
  const lang = useAppStore((state) => state.language) ?? 'en';
  const finished = useFinishedStore((state) => state.version);
  return useQuery({
    queryKey: [...LOCAL_QUERY_KEY, 'tours', areaId, lang, finished],
    queryFn: async () =>
      (await load(lang, areaId ?? undefined)).filter((row) => row.tour.liveCount >= 2),
    enabled: areaId !== null,
    networkMode: 'always',
    // A finished story moves the key: the last answer stays while the new one is read, so the bar
    // never blinks out (and its stop-heard toast sees the count move).
    placeholderData: keepPreviousData,
  });
}

/** One tour on this phone, or `null` when the phone doesn't hold it (TM6b) or it isn't shown. */
export function useLocalTour(tourId: string | null) {
  const lang = useAppStore((state) => state.language) ?? 'en';
  const finished = useFinishedStore((state) => state.version);
  return useQuery({
    queryKey: [...LOCAL_QUERY_KEY, 'tour', tourId, lang, finished],
    queryFn: async () => (await load(lang, undefined, tourId!))[0] ?? null,
    enabled: tourId !== null,
    networkMode: 'always',
    // A finished story moves the key: the last answer stays while the new one is read, so the bar
    // never blinks out (and its stop-heard toast sees the count move).
    placeholderData: keepPreviousData,
  });
}
