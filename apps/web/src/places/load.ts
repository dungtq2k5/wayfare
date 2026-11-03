import 'server-only';
import { ApiError, areasList, narrationStatus, placesByCode } from '@wayfare/api-client';
import type { AreaResponseDto, PlaceDetailResponseDto } from '@wayfare/api-client';
import { cache } from 'react';
import '../server/api';
import { visitorOptions } from '../server/api';

/** The areas, as `/areas` serves them (a public, cached read). */
export const loadAreas = cache(async (): Promise<AreaResponseDto[]> => {
  try {
    return (await areasList({ next: { revalidate: 300 } })).data;
  } catch {
    return [];
  }
});

export type PlaceLookup =
  | {
      readonly kind: 'place';
      readonly place: PlaceDetailResponseDto;
      /** The same Place in Vietnamese, for the names under the translated ones; null when vi. */
      readonly vi: PlaceDetailResponseDto | null;
      readonly area: AreaResponseDto | null;
      /** Whether its audio in the served language is being made (WN3 on arrival). */
      readonly audioPending: boolean;
    }
  | {
      readonly kind: 'gone';
      readonly area: AreaResponseDto | null;
      readonly near: { readonly lat: number; readonly lng: number } | null;
    }
  | { readonly kind: 'missing' };

/**
 * A sticker's Place (K3, K4), read on the server with no device: the Place in the page's language,
 * its Vietnamese names, its area and its narration; a Place no longer listed says where it was.
 */
export const loadPlace = cache(async (code: string, lang: string): Promise<PlaceLookup> => {
  const options = await visitorOptions();
  try {
    const [{ data: place }, areas] = await Promise.all([
      placesByCode(code, { lang }, options),
      loadAreas(),
    ]);
    const [vi, status] = await Promise.all([
      place.localization.lang === 'vi' && lang === 'vi'
        ? Promise.resolve(null)
        : placesByCode(code, { lang: 'vi' }, options).then(
            (answer) => answer.data,
            () => null,
          ),
      narrationStatus(place.id, { lang: place.localization.lang }, options).then(
        (answer) => answer.data,
        () => null,
      ),
    ]);
    return {
      kind: 'place',
      place,
      vi,
      area: areas.find((area) => area.id === place.areaId) ?? null,
      audioPending: status !== null && status.audio === null && status.audioStatus === 'PENDING',
    };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'PLACE_UNAVAILABLE') {
      const details = error.details as
        { areaCode?: string; near?: { lat: number; lng: number } } | undefined;
      const areas = await loadAreas();
      return {
        kind: 'gone',
        area: areas.find((area) => area.code === details?.areaCode) ?? null,
        near: details?.near ?? null,
      };
    }
    if (
      error instanceof ApiError &&
      (error.code === 'RESOURCE_NOT_FOUND' || error.code === 'VALIDATION_FAILED')
    )
      return { kind: 'missing' };
    throw error;
  }
});
