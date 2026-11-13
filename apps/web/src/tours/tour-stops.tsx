'use client';

import { placesGet } from '@wayfare/api-client';
import type { AreaResponseDto, TourDetailResponseDto } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { RouteMap } from '@wayfare/ui/route-map';
import { Check, Minus, Navigation, Play, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useWeb } from '../i18n/provider';
import { areaStyle } from '../map/style';
import { useDistanceText } from '../places/place-card';
import { player } from '../player/player';
import type { Track } from '../player/track';
import {
  beginTour,
  FINISHED_EVENT,
  finishedStories,
  tourProgress,
  tourStartedAt,
} from './progress';
import type { TourProgress } from './progress';

type Stop = TourDetailResponseDto['stops'][number];

/**
 * A tour's stops on the web (TW2, TW2b): *Play stop n* for the first not played, the route, and
 * each stop with its own *Play* — the web never knows where you are, so each is played by hand.
 * Progress is this browser's: stories finished since the tour's first *Play* here (K8).
 */
export function TourStops({
  tour,
  area,
  header,
  footer,
}: {
  tour: TourDetailResponseDto;
  area: Pick<AreaResponseDto, 'code' | 'mapPack'> | null;
  /** The page's own top: the cover, the title, the honest line. */
  header: ReactNode;
  footer: ReactNode;
}) {
  const { t, tDynamic, locale } = useWeb();
  const distanceText = useDistanceText();
  const [progress, setProgress] = useState<TourProgress>(() => ({
    played: new Set(),
    next: tour.stops.find((stop) => stop.place !== null)?.position ?? null,
  }));
  const [style, setStyle] = useState<string | null>(null);
  useEffect(() => setStyle(areaStyle(area)), [area]);
  const refresh = useCallback(async () => {
    const [finished, startedAt] = await Promise.all([finishedStories(), tourStartedAt(tour.id)]);
    setProgress(
      tourProgress(
        tour.stops.map((stop) => ({ position: stop.position, placeId: stop.place?.id ?? null })),
        finished,
        startedAt,
      ),
    );
  }, [tour]);
  useEffect(() => {
    void refresh();
    const listen = () => void refresh();
    window.addEventListener(FINISHED_EVENT, listen);
    return () => window.removeEventListener(FINISHED_EVENT, listen);
  }, [refresh]);

  const play = async (stop: Stop) => {
    if (stop.place === null) return;
    await beginTour(tour.id);
    const { data } = await placesGet(stop.place.id, { lang: locale });
    const loc = data.localization;
    const track: Track = {
      placeId: data.id,
      code: data.publicCode,
      name: loc.name,
      categoryCode: data.categoryCode,
      areaCode: area?.code ?? null,
      photoUrl: data.photos[0]?.card.url ?? null,
      lang: loc.lang,
      text: loc.description,
      audio: loc.audio === null ? null : { url: loc.audio.url, durationMs: loc.audio.durationMs },
    };
    void player.play(track);
  };

  const live = tour.stops.filter((stop) => stop.place !== null);
  const total = live.length;
  const played = progress.played.size;
  const next = tour.stops.find((stop) => stop.position === progress.next) ?? null;
  const number = (stop: Stop) => stop.position + 1;
  const previousLive = (index: number) => {
    for (let i = index - 1; i >= 0; i--) if (tour.stops[i]!.place !== null) return tour.stops[i]!;
    return null;
  };

  return (
    // One column on a phone; from 1200 px the story's column beside a card of the route and the
    // stops, as a Place's page.
    <div className="mx-auto flex w-full flex-col desk:place-columns desk:grid desk:max-w-300 desk:justify-center desk:gap-x-8 desk:px-6 desk:py-8">
      <div className="flex min-w-0 flex-col gap-4 desk:col-start-1">
        {header}
        <div className="flex flex-col gap-4 px-4 desk:p-0">
          {played === 0 ? null : (
            <p className="flex items-center gap-3 text-sm text-foreground">
              <span aria-hidden className="h-1.5 w-30 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${(played / Math.max(1, total)) * 100}%` }}
                />
              </span>
              {t('tour.playedHere', { n: played, total })}
            </p>
          )}
          {next?.place == null ? null : (
            <Button size="lg" className="w-full sm:w-fit" onClick={() => void play(next)}>
              <Play aria-hidden />
              {t('tour.playStop', { n: number(next), place: next.place.name })}
            </Button>
          )}
          <p lang={tour.text.lang} className="text-base whitespace-pre-line text-foreground">
            {tour.text.description}
          </p>
        </div>
      </div>
      <aside className="flex flex-col gap-4 px-4 pt-4 desk:col-start-2 desk:row-start-1 desk:h-fit desk:rounded-lg desk:border desk:border-border desk:bg-card desk:p-5">
        <section aria-labelledby="route-heading" className="flex flex-col gap-3">
          <h2 id="route-heading" className="text-lg font-semibold text-foreground">
            {t('tour.route')}
          </h2>
          {style === null ? (
            <div className="h-48 rounded-lg bg-muted" />
          ) : (
            <RouteMap
              style={style}
              className="h-48 rounded-lg"
              stops={live.map((stop) => ({
                point: stop.place!.location,
                label: String(number(stop)),
                state: progress.played.has(stop.position)
                  ? 'heard'
                  : stop.position === progress.next
                    ? 'next'
                    : 'upcoming',
              }))}
              label={t('tour.routeLabel', { tour: tour.text.title })}
            />
          )}
        </section>
        <section aria-labelledby="stops-heading" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="stops-heading" className="text-lg font-semibold text-foreground">
              {t('tour.stopsTitle')}
            </h2>
            <span className="text-sm text-muted-foreground">
              {t('tour.playedOf', { n: played, total })}
            </span>
          </div>
          <ol className="flex flex-col">
            {tour.stops.map((stop, index) => {
              const place = stop.place;
              const isPlayed = progress.played.has(stop.position);
              const isNext = stop.position === progress.next;
              const from = previousLive(index);
              const leg =
                from === null
                  ? t('tour.startHere')
                  : t('tour.legFrom', { distance: distanceText(stop.legM), n: number(from) });
              return (
                <li key={stop.position} className="flex gap-3">
                  {/* Round 39's *Stop row*: the number on a rail that joins it to the next. */}
                  <span aria-hidden className="flex shrink-0 flex-col items-center">
                    <span
                      className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-medium ${
                        place === null
                          ? 'border-dashed border-muted-foreground text-muted-foreground'
                          : isPlayed
                            ? 'border-transparent bg-accent text-primary'
                            : isNext
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-primary text-primary'
                      }`}
                    >
                      {place === null ? (
                        <Minus className="size-4" />
                      ) : isPlayed ? (
                        <Check className="size-4" />
                      ) : (
                        number(stop)
                      )}
                    </span>
                    {index === tour.stops.length - 1 ? null : (
                      <span className="w-0.5 grow bg-border" />
                    )}
                  </span>
                  {place === null ? (
                    <span className="flex min-w-0 grow flex-col pb-4">
                      <span className="font-medium text-muted-foreground">
                        {t('tour.stopN', { n: number(stop) })}
                      </span>
                      <span className="text-sm text-muted-foreground">{t('tour.skipped')}</span>
                    </span>
                  ) : (
                    <>
                      <span className="flex min-w-0 grow flex-col pb-4">
                        <span
                          className={`font-semibold ${isPlayed ? 'text-muted-foreground' : 'text-foreground'}`}
                        >
                          {place.name}
                        </span>
                        {place.nameVi === place.name ? null : (
                          <span lang="vi" className="text-sm text-muted-foreground">
                            {place.nameVi}
                          </span>
                        )}
                        <span className="text-sm text-muted-foreground">
                          {tDynamic(`category.${place.categoryCode}`)} · {leg}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-start gap-2">
                        {isPlayed ? (
                          <span className="pt-2 text-sm text-muted-foreground">
                            {t('tour.played')}
                          </span>
                        ) : isNext ? (
                          <span className="mt-2 inline-flex h-fit items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-sm font-medium text-accent-foreground">
                            <Navigation aria-hidden className="size-3" />
                            {t('tour.next')}
                          </span>
                        ) : null}
                        <Button
                          variant="outline"
                          size="icon"
                          className="rounded-full"
                          aria-label={t('tour.playStory', { place: place.name })}
                          onClick={() => void play(stop)}
                        >
                          {isPlayed ? <RotateCcw aria-hidden /> : <Play aria-hidden />}
                        </Button>
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
        <div className="pb-6 desk:pb-0">{footer}</div>
      </aside>
    </div>
  );
}
