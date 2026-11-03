'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { areasList, favoritesList } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { CircleCheck, Heart, Map as MapIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMe } from '../account/me';
import { MERGE_NOTE_KEY } from '../account/complete-sign-in';
import { readKv, writeKv } from '../client/db';
import { useWeb } from '../i18n/provider';
import { insidePolygon } from '../map/geo';
import { categoryIcon } from '../places/category-icon';
import { linkCode } from '../places/format';
import { FavouriteToggle } from './favourite-toggle';
import { FAVOURITES_KEY, favouriteKey } from './use-favourite';

/**
 * Saved places (WA3): newest first, on this browser's device — the union across every device when
 * signed in, said once after signing in elsewhere (WA3c). Unsaving has Undo.
 */
export function FavouritesView() {
  const { t, tDynamic, locale } = useWeb();
  const me = useMe();
  const favourites = useQuery({
    queryKey: [...FAVOURITES_KEY, locale],
    queryFn: async () => (await favoritesList({ lang: locale, limit: 100 })).data,
  });
  const areas = useQuery({
    queryKey: ['areas'],
    queryFn: async () => (await areasList()).data,
    staleTime: 300_000,
  });
  // Each heart on the list is on: no read per Place.
  const queries = useQueryClient();
  useEffect(() => {
    for (const row of favourites.data ?? []) {
      if (queries.getQueryData(favouriteKey(row.placeId)) === undefined)
        queries.setQueryData(favouriteKey(row.placeId), true);
    }
  }, [favourites.data, queries]);
  const [merged, setMerged] = useState<{ others: number; here: number } | null>(null);
  useEffect(() => {
    void readKv(MERGE_NOTE_KEY, '').then((note) => {
      if (note === '') return;
      setMerged(JSON.parse(note) as { others: number; here: number });
      // Said once.
      void writeKv(MERGE_NOTE_KEY, '');
    });
  }, []);
  const areaOf = (point: { lat: number; lng: number }) =>
    areas.data?.find((area) => insidePolygon(point, area.boundary))?.code ?? null;
  const signedIn = me.data !== null && me.data !== undefined;
  const rows = favourites.data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-170 flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-semibold text-foreground">{t('fav.title')}</h1>
      <p className="text-base text-muted-foreground">
        {signedIn ? t('fav.lead') : t('fav.leadAnonymous')}
      </p>
      {merged !== null && signedIn ? (
        <div
          role="status"
          className="flex gap-2 rounded-md bg-success px-4 py-3 text-sm text-success-foreground"
        >
          <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-medium">
              {t('fav.mergedTitle', { email: me.data?.user.email ?? '' })}
            </p>
            <p>{t('fav.mergedBody', { n: merged.others, m: merged.here })}</p>
          </div>
        </div>
      ) : null}
      {favourites.isSuccess && rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Heart aria-hidden className="size-7" />
          </span>
          <h2 className="text-lg font-semibold text-foreground">{t('fav.emptyTitle')}</h2>
          <p className="max-w-sm text-sm text-muted-foreground">{t('fav.emptyBody')}</p>
          <Button asChild size="lg" variant="outline">
            <Link href="/map">
              <MapIcon aria-hidden />
              {t('fav.openMap')}
            </Link>
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const Icon = categoryIcon(row.place.categoryCode);
            const area = areaOf(row.place.location);
            return (
              <li
                key={row.placeId}
                className="flex items-start gap-3 rounded-xl bg-card p-3 shadow-1"
              >
                <Link
                  href={`/p/${linkCode(row.place.publicCode)}`}
                  className="flex min-w-0 flex-1 items-start gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex size-18 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
                    {row.place.cardPhoto === null ? (
                      <Icon aria-hidden className="size-6" />
                    ) : (
                      <img
                        src={row.place.cardPhoto.url}
                        alt=""
                        className="size-full object-cover"
                      />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-base font-semibold text-foreground">
                      {row.place.name}
                    </span>
                    <span className="flex flex-wrap items-center gap-1 text-sm font-medium text-muted-foreground">
                      <Icon aria-hidden className="size-4" />
                      {tDynamic(`category.${row.place.categoryCode}`)}
                      {area === null ? null : (
                        <>
                          <span aria-hidden>·</span>
                          {tDynamic(`area.${area}`)}
                        </>
                      )}
                    </span>
                  </span>
                </Link>
                <FavouriteToggle placeId={row.placeId} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
