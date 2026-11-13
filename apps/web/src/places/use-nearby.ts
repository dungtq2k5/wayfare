'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { placesNearby } from '@wayfare/api-client';
import { useWeb } from '../i18n/provider';

/** The list near a point (K5): `nearby`'s order, distance adjusted by a boost (K17). */
export function useNearby(
  point: { lat: number; lng: number } | null,
  radiusM: number,
  categoryCode?: string | null,
) {
  const { locale } = useWeb();
  // Rounded, so a map nudged a few metres asks nothing new.
  const lat = point === null ? null : Math.round(point.lat * 2000) / 2000;
  const lng = point === null ? null : Math.round(point.lng * 2000) / 2000;
  const radius = Math.max(100, Math.min(5000, Math.round(radiusM / 100) * 100));
  return useQuery({
    queryKey: ['nearby', lat, lng, radius, categoryCode ?? null, locale],
    enabled: lat !== null && lng !== null,
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (
        await placesNearby({
          lat: lat!,
          lng: lng!,
          radiusM: radius,
          lang: locale,
          limit: 50,
          ...(categoryCode === null || categoryCode === undefined ? {} : { categoryCode }),
        })
      ).data,
  });
}
