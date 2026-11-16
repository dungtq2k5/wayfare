import {
  ContentTier,
  MenuCurrency,
  PlaceKind,
  zGeoPoint,
  zOpeningHoursRow,
  zPhotoView,
  zPlaceLocalization,
  zPlaceSummary,
  zPublicCode,
  zUuidV7,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** One nearby result (api-endpoints-plan §2.1). */
export class PlaceSummaryResponseDto extends createZodDto(zPlaceSummary) {}

/** A Place's full tourist view (api-endpoints-plan §2.1). */
export const placeDetailResponseSchema = z.object({
  id: zUuidV7,
  kind: z.enum(PlaceKind),
  publicCode: zPublicCode,
  categoryCode: z.string(),
  areaId: zUuidV7,
  location: zGeoPoint,
  /** In Vietnamese: it is read against a street sign. */
  address: z.string().nullable(),
  triggerRadiusM: z.number().int(),
  narrationPriority: z.number().int(),
  autoNarrationEnabled: z.boolean(),
  localization: zPlaceLocalization,
  photos: z.array(
    z.object({
      id: zUuidV7,
      altText: z.string().nullable(),
      thumb: zPhotoView,
      card: zPhotoView,
      full: zPhotoView,
    }),
  ),
  /** Venues only; display prices in the menu's own currency (ADR 0046). */
  menu: z
    .object({
      menuCurrency: z.enum(MenuCurrency),
      items: z.array(
        z.object({
          id: zUuidV7,
          name: z.string(),
          description: z.string().nullable(),
          priceMinor: z.number().int().nullable(),
          isAvailable: z.boolean(),
          contentTier: z.enum(ContentTier),
          stale: z.boolean(),
        }),
      ),
    })
    .nullable(),
  openingHours: z.array(zOpeningHoursRow),
  priceBand: z.number().int().nullable(),
  phone: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  /** Active voucher offers — empty until billing is deployed. */
  offers: z.array(z.never()),
  /** False until favourites exist. */
  isFavorite: z.boolean(),
});

/** What `GET /places/:id` and `GET /places/by-code/:publicCode` return under `data`. */
export class PlaceDetailResponseDto extends createZodDto(placeDetailResponseSchema) {}
