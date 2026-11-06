'use client';

import type { TourSummaryResponseDto } from '@wayfare/api-client';
import { Footprints, ListOrdered, Route, Timer } from 'lucide-react';
import Link from 'next/link';
import { useWeb } from '../i18n/provider';
import { linkCode } from '../places/format';
import { useDistanceText } from '../places/place-card';

/** A tour's time: "45 min", "2 h", "1 h 15". */
export function useTourTime(): (minutes: number) => string {
  const { t } = useWeb();
  return (minutes) => {
    if (minutes < 60) return t('tours.minutes', { m: minutes });
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? t('tours.hours', { h }) : t('tours.hoursMinutes', { h, m });
  };
}

/**
 * The *Tour card* (round 39): its cover, the title, stops · time · distance, and — once this
 * browser began it — how many stops played here. The whole card opens the tour.
 */
export function TourCard({
  tour,
  played,
}: {
  tour: TourSummaryResponseDto;
  /** Stops played on this browser since the tour began; absent before its first *Play*. */
  played?: number | undefined;
}) {
  const { t } = useWeb();
  const distanceText = useDistanceText();
  const time = useTourTime();
  return (
    <Link
      href={`/t/${linkCode(tour.publicCode)}`}
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {tour.cover === null ? (
        <span className="flex aspect-video items-center justify-center bg-muted text-muted-foreground">
          <Route aria-hidden className="size-8" />
        </span>
      ) : (
        <img src={tour.cover.url} alt="" className="aspect-video w-full object-cover" />
      )}
      <span className="flex flex-col gap-2 p-4">
        <span className="text-lg font-semibold text-foreground">{tour.text.title}</span>
        <span className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ListOrdered aria-hidden className="size-4" />
            {t('tours.stops', { n: tour.stopCount })}
          </span>
          <span className="inline-flex items-center gap-1">
            <Timer aria-hidden className="size-4" />
            {time(tour.estimatedMinutes)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Footprints aria-hidden className="size-4" />
            {distanceText(tour.distanceM)}
          </span>
        </span>
        {played === undefined || played === 0 ? null : (
          <span className="flex items-center gap-3 text-sm text-foreground">
            <span aria-hidden className="h-1.5 w-30 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${(played / Math.max(1, tour.stopCount)) * 100}%` }}
              />
            </span>
            {t('tours.played', { n: played, total: tour.stopCount })}
          </span>
        )}
      </span>
    </Link>
  );
}
