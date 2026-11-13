import 'server-only';
import { ApiError, codesResolve, toursByCode } from '@wayfare/api-client';
import type { AreaResponseDto, TourDetailResponseDto } from '@wayfare/api-client';
import { cache } from 'react';
import { loadAreas } from '../places/load';
import { visitorOptions } from '../server/api';

export type TourLookup =
  | {
      readonly kind: 'tour';
      readonly tour: TourDetailResponseDto;
      readonly area: AreaResponseDto | null;
    }
  | { readonly kind: 'gone'; readonly area: AreaResponseDto | null }
  | { readonly kind: 'missing' };

/**
 * A tour from its link or sticker (TW2), read on the server with no device; one no longer shown —
 * taken down, or too few of its places open — says which area it was in (TW3).
 */
export const loadTour = cache(async (code: string, lang: string): Promise<TourLookup> => {
  const options = await visitorOptions();
  try {
    const [{ data: tour }, areas] = await Promise.all([
      toursByCode(code, { lang }, options),
      loadAreas(),
    ]);
    return { kind: 'tour', tour, area: areas.find((area) => area.id === tour.areaId) ?? null };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'TOUR_UNAVAILABLE') {
      const details = error.details as { areaCode?: string } | undefined;
      const areas = await loadAreas();
      return { kind: 'gone', area: areas.find((area) => area.code === details?.areaCode) ?? null };
    }
    if (
      error instanceof ApiError &&
      (error.code === 'RESOURCE_NOT_FOUND' || error.code === 'VALIDATION_FAILED')
    )
      return { kind: 'missing' };
    throw error;
  }
});

/** Whether a code names a tour (the one code space): `/p/` sends a tour's code on to `/t/`. */
export async function isTourCode(code: string): Promise<boolean> {
  try {
    const { data } = await codesResolve(code, await visitorOptions());
    return data.type === 'TOUR';
  } catch {
    return false;
  }
}
