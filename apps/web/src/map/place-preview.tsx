'use client';

import { useQuery } from '@tanstack/react-query';
import { placesGet } from '@wayfare/api-client';
import type { PlaceSummaryResponseDto } from '@wayfare/api-client';
import { openingState } from '@wayfare/core';
import { X } from 'lucide-react';
import Link from 'next/link';
import { FavouriteToggle } from '../favourites/favourite-toggle';
import { useWeb } from '../i18n/provider';
import { PlayStory } from '../player/play-story';
import type { Track } from '../player/track';
import { categoryIcon } from '../places/category-icon';
import { linkCode } from '../places/format';
import { OpeningBadge, openingLabel } from '../places/opening-hours';
import { useDistanceText } from '../places/place-card';

/** A Place's detail in the page's language and in Vietnamese, for the preview. */
function usePreviewDetail(placeId: string) {
  const { locale } = useWeb();
  const detail = useQuery({
    queryKey: ['place', placeId, locale],
    queryFn: async () => (await placesGet(placeId, { lang: locale })).data,
  });
  const vi = useQuery({
    queryKey: ['place', placeId, 'vi'],
    enabled: locale !== 'vi',
    queryFn: async () => (await placesGet(placeId, { lang: 'vi' })).data,
  });
  return { detail: detail.data, vi: locale === 'vi' ? undefined : vi.data };
}

/**
 * A Place's preview (WM3): its photo, names, category and area, open now, how far, *Play the story*
 * and *Open the full page*. In the bottom sheet on a phone and at 720 px; in the 400 px side panel
 * from 1200 px.
 */
export function PlacePreview({
  place,
  areaCode,
  fromYou,
  onClose,
  panel,
}: {
  place: PlaceSummaryResponseDto;
  areaCode: string;
  fromYou: boolean;
  onClose?: () => void;
  panel: boolean;
}) {
  const { t, tDynamic, locale } = useWeb();
  const away = useDistanceText();
  const { detail, vi } = usePreviewDetail(place.id);
  const Category = categoryIcon(place.categoryCode);
  const loc = detail?.localization;
  const opening = detail === undefined ? null : openingState(detail.openingHours, Date.now());
  const badge = opening === null ? null : openingLabel(opening, t, locale);
  const nameVi =
    vi !== undefined && vi.localization.name !== place.name ? vi.localization.name : null;
  const photo = detail?.photos[0]?.card.url ?? place.cardPhoto?.url ?? null;
  const track: Track | null =
    loc === undefined
      ? null
      : {
          placeId: place.id,
          code: place.publicCode,
          name: loc.name,
          categoryCode: place.categoryCode,
          areaCode,
          photoUrl: photo,
          lang: loc.lang,
          text: loc.description,
          audio:
            loc.audio === null ? null : { url: loc.audio.url, durationMs: loc.audio.durationMs },
        };
  const distanceLine = fromYou
    ? t('map.fromYou', { distance: away(place.distanceM) })
    : t('map.fromCentre', { distance: away(place.distanceM) });
  const name = (
    <div className="flex items-start gap-2">
      <h2 className="min-w-0 flex-1 text-2xl font-semibold text-foreground">{place.name}</h2>
      <FavouriteToggle placeId={place.id} />
    </div>
  );

  if (panel) {
    return (
      <aside
        aria-label={place.name}
        className="absolute top-4 right-4 z-10 flex w-100 flex-col gap-3 overflow-y-auto rounded-2xl bg-card p-5 shadow-3"
        style={{ maxHeight: 'calc(100% - 2rem)' }}
      >
        <button
          type="button"
          aria-label={t('map.closePanel')}
          onClick={onClose}
          className="flex size-11 items-center justify-center self-end rounded-md text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden className="size-6" />
        </button>
        <div className="flex h-50 w-full items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
          {photo === null ? (
            <Category aria-hidden className="size-10" />
          ) : (
            <img src={photo} alt="" className="size-full object-cover" />
          )}
        </div>
        {name}
        {nameVi === null ? null : (
          <p lang="vi" className="text-sm text-muted-foreground">
            {nameVi}
          </p>
        )}
        <p className="flex items-center gap-1 text-sm text-muted-foreground">
          <Category aria-hidden className="size-4" />
          {tDynamic(`category.${place.categoryCode}`)} · {tDynamic(`area.${areaCode}`)}
        </p>
        {badge === null ? null : <OpeningBadge label={badge} open={opening?.kind === 'open'} />}
        <p className="text-sm text-muted-foreground">{distanceLine}</p>
        {track === null ? null : (
          <PlayStory track={track} note={null} englishFallback={false} fill />
        )}
        <Link
          href={`/p/${linkCode(place.publicCode)}`}
          className="self-start rounded-sm text-base text-primary underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('map.openFull')}
        </Link>
      </aside>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
          {photo === null ? (
            <Category aria-hidden className="size-8" />
          ) : (
            <img src={photo} alt="" className="size-full object-cover" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {name}
          {nameVi === null ? null : (
            <p lang="vi" className="text-sm text-muted-foreground">
              {nameVi}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {tDynamic(`category.${place.categoryCode}`)} · {away(place.distanceM)}
          </p>
          {badge === null ? null : <OpeningBadge label={badge} open={opening?.kind === 'open'} />}
        </div>
      </div>
      {track === null ? null : <PlayStory track={track} note={null} englishFallback={false} fill />}
      <Link
        href={`/p/${linkCode(place.publicCode)}`}
        className="self-start rounded-sm text-base text-primary underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t('map.openFull')}
      </Link>
    </div>
  );
}
