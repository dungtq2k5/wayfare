'use client';

import type { AreaResponseDto } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { CircleX, Map as MapIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useWeb } from '../i18n/provider';
import { AreaMap } from '../map/area-map';
import { areaStyle } from '../map/style';
import { PlaceCard } from './place-card';
import { useNearby } from './use-nearby';

/**
 * WQ4 / WQ5c: a sticker for a Place no longer on Wayfare (K4). No name, kindly; the area's map and
 * its nearest live Places, around where the sticker is.
 */
export function PlaceGone({
  area,
  near,
}: {
  area: AreaResponseDto | null;
  near: { lat: number; lng: number } | null;
}) {
  const { t, tDynamic } = useWeb();
  const point = near ?? area?.center ?? null;
  const nearby = useNearby(point, 1000);
  const [style, setStyle] = useState<string | null>(null);
  useEffect(() => setStyle(areaStyle(area)), [area]);
  const areaName = area === null ? null : tDynamic(`area.${area.code}`);
  const places = (nearby.data ?? []).slice(0, 3);
  return (
    <div className="mx-auto flex w-full max-w-170 flex-col gap-4 px-4 py-5">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <CircleX aria-hidden className="size-6" />
      </span>
      <h1 className="text-2xl font-semibold text-foreground">{t('gone.title')}</h1>
      <p className="text-base text-muted-foreground">{t('gone.body')}</p>
      {point === null ? null : (
        <AreaMap
          style={style}
          center={point}
          zoom={16}
          places={places.map((place) => ({
            id: place.id,
            categoryCode: place.categoryCode,
            name: place.name,
            location: place.location,
          }))}
          label={areaName ?? t('gone.near')}
          className="h-40 rounded-lg"
        />
      )}
      <h2 className="text-lg font-semibold text-foreground">{t('gone.near')}</h2>
      <ul className="flex flex-col gap-3">
        {places.map((place) => (
          <li key={place.id}>
            <PlaceCard place={place} walking />
          </li>
        ))}
      </ul>
      {area === null || areaName === null ? null : (
        <Button asChild variant="outline" size="lg" className="self-start">
          <Link href={`/map/${area.code}`}>
            <MapIcon aria-hidden />
            {t('gone.openMap', { area: areaName })}
          </Link>
        </Button>
      )}
    </div>
  );
}
