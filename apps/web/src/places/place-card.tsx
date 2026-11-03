'use client';

import type { PlaceSummaryResponseDto } from '@wayfare/api-client';
import { cn } from '@wayfare/ui/cn';
import { Footprints } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useWeb } from '../i18n/provider';
import { categoryIcon } from './category-icon';
import { distance, linkCode } from './format';

/** "120 m" or "1,5 km" in the page's numbers. */
export function useDistanceText(): (metres: number) => string {
  const { t, locale } = useWeb();
  return (metres) => {
    const { unit, n } = distance(metres, locale);
    return unit === 'm' ? t('distance.m', { n }) : t('distance.km', { n });
  };
}

/**
 * The Place card (round 25): the photo or the category's icon, the name, the category and the
 * distance — walking minutes when the tourist's own position sorts the list — and *Sponsored* for
 * a boosted Place (K17). The whole card opens the Place, or calls `onOpen`.
 */
export function PlaceCard({
  place,
  walking = false,
  onOpen,
  selected = false,
  extra,
  hideDistance = false,
}: {
  place: Pick<
    PlaceSummaryResponseDto,
    | 'publicCode'
    | 'name'
    | 'categoryCode'
    | 'cardPhoto'
    | 'distanceM'
    | 'walkingEtaMinutes'
    | 'sponsored'
  >;
  walking?: boolean;
  onOpen?: () => void;
  selected?: boolean;
  extra?: ReactNode;
  /** A Place opened earlier (WM5b): its category only, no distance. */
  hideDistance?: boolean;
}) {
  const { t, tDynamic } = useWeb();
  const away = useDistanceText();
  const Icon = categoryIcon(place.categoryCode);
  const body = (
    <>
      <span className="flex size-18 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
        {place.cardPhoto === null ? (
          <Icon aria-hidden className="size-6" />
        ) : (
          <img src={place.cardPhoto.url} alt="" className="size-full object-cover" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 text-left">
        <span className="text-base font-semibold text-foreground">{place.name}</span>
        <span className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm font-medium text-muted-foreground">
          <Icon aria-hidden className="size-4" />
          {tDynamic(`category.${place.categoryCode}`)}
          {hideDistance ? null : (
            <>
              <span aria-hidden>·</span>
              <Footprints aria-hidden className="size-4" />
              {away(place.distanceM)}
            </>
          )}
          {walking && !hideDistance ? (
            <>
              <span aria-hidden>·</span>
              {t('map.minutes', { n: place.walkingEtaMinutes })}
            </>
          ) : null}
        </span>
        {place.sponsored ? (
          <span className="w-fit rounded-full bg-warning px-2 py-0.5 text-xs font-medium text-warning-foreground">
            {t('card.sponsored')}
          </span>
        ) : null}
        {extra}
      </span>
    </>
  );
  const shell = cn(
    'flex w-full items-start gap-3 rounded-xl bg-card p-3 shadow-1 outline-none focus-visible:ring-2 focus-visible:ring-ring',
    selected && 'ring-2 ring-primary',
  );
  return onOpen === undefined ? (
    <Link href={`/p/${linkCode(place.publicCode)}`} className={shell}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onOpen} className={shell} aria-current={selected || undefined}>
      {body}
    </button>
  );
}
