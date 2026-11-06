'use client';

import { useQuery } from '@tanstack/react-query';
import { toursGet, toursList } from '@wayfare/api-client';
import type { TourSummaryResponseDto } from '@wayfare/api-client';
import { Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useWeb } from '../i18n/provider';
import { finishedStories, tourProgress, tourStartedAt } from './progress';
import { TourCard } from './tour-card';

/** An area's tours, in the page's language (`GET /tours`). */
export function useTours(areaId: string | null) {
  const { locale } = useWeb();
  return useQuery({
    queryKey: ['tours', areaId, locale],
    queryFn: async () => (await toursList({ areaId: areaId!, lang: locale, limit: 50 })).data,
    enabled: areaId !== null,
  });
}

/** How many stops of each tour played on this browser since it began there. */
function usePlayed(tours: readonly TourSummaryResponseDto[]): Map<string, number> {
  const { locale } = useWeb();
  const [played, setPlayed] = useState(new Map<string, number>());
  useEffect(() => {
    let alive = true;
    void (async () => {
      const finished = await finishedStories();
      const next = new Map<string, number>();
      for (const tour of tours) {
        const startedAt = await tourStartedAt(tour.id);
        if (startedAt === null) continue;
        const { data } = await toursGet(tour.id, { lang: locale });
        const progress = tourProgress(
          data.stops.map((stop) => ({ position: stop.position, placeId: stop.place?.id ?? null })),
          finished,
          startedAt,
        );
        next.set(tour.id, progress.played.size);
      }
      if (alive) setPlayed(next);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [tours, locale]);
  return played;
}

/**
 * The *Tours* tab of an area's list (TW1): its tours as cards, those begun here with their progress,
 * and the editors' line at the end.
 */
export function ToursList({
  areaId,
  areaName,
  exclude,
  bare = false,
}: {
  areaId: string;
  areaName: string;
  /** A tour not to list again (TW3's own). */
  exclude?: string;
  /** Cards only, under a page's own heading (TW3). */
  bare?: boolean;
}) {
  const { t } = useWeb();
  const tours = useTours(areaId);
  const rows = (tours.data ?? []).filter((tour) => tour.id !== exclude);
  const played = usePlayed(rows);
  return (
    <div className="flex flex-col gap-4">
      {bare ? null : (
        <p className="text-sm text-muted-foreground">{t('tours.inArea', { area: areaName })}</p>
      )}
      {tours.isSuccess && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('tours.none')}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((tour) => (
            <li key={tour.id}>
              <TourCard tour={tour} played={played.get(tour.id)} />
            </li>
          ))}
        </ul>
      )}
      {bare ? null : (
        <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('tours.editorial')}
        </p>
      )}
    </div>
  );
}
