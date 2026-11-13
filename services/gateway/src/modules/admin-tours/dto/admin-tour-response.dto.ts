import {
  PlaceStatus,
  TourStatus,
  TranslationSource,
  zGeoPoint,
  zPhotoView,
  zUuidV7,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const zInstant = z.iso.datetime({ offset: true });

/** What a tour's gate still waits for: its English text and the request (rdm-spec C-8). */
const zTourGateMissing = z.enum(['en.text', 'activation']);

/** A console table row (api-endpoints-plan §3.6). */
export const adminTourListItemResponseSchema = z.object({
  id: zUuidV7,
  publicCode: z.string(),
  titleVi: z.string(),
  areaId: zUuidV7,
  areaCode: z.string(),
  status: z.enum(TourStatus),
  /** Inactive because an admin took it down. */
  inactiveByAdmin: z.boolean(),
  activationRequested: z.boolean(),
  estimatedMinutes: z.number().int(),
  distanceM: z.number().int(),
  liveStops: z.number().int(),
  totalStops: z.number().int(),
  /** Fewer than two live stops: still its status, but tourists don't see it (rdm-spec C-8). */
  hiddenFromTourists: z.boolean(),
  cover: zPhotoView.nullable(),
  updatedAt: zInstant,
  deletedAt: zInstant.nullable(),
});

/** One row of `GET /admin/tours`. */
export class AdminTourListItemResponseDto extends createZodDto(adminTourListItemResponseSchema) {}

/** A stop as staff see it: whatever its Place became. */
export const adminTourStopResponseSchema = z.object({
  position: z.number().int(),
  placeId: zUuidV7,
  publicCode: z.string(),
  nameVi: z.string(),
  /** Its Place's English name, when narration has made it. */
  nameEn: z.string().nullable(),
  categoryCode: z.string(),
  status: z.enum(PlaceStatus),
  deleted: z.boolean(),
  /** Its Place moved out of the tour's area since it was added. */
  outsideArea: z.boolean(),
  location: zGeoPoint,
  /** The straight line from the stop before; 0 for the first. */
  legM: z.number().int(),
});

/** A tour in full, for the console. */
export const adminTourResponseSchema = z.object({
  id: zUuidV7,
  publicCode: z.string(),
  areaId: zUuidV7,
  areaCode: z.string(),
  titleVi: z.string(),
  descriptionVi: z.string(),
  contentHash: z.string(),
  estimatedMinutes: z.number().int(),
  distanceM: z.number().int(),
  cover: z.object({ thumb: zPhotoView, card: zPhotoView, full: zPhotoView }).nullable(),
  status: z.enum(TourStatus),
  inactiveByAdmin: z.boolean(),
  activationRequestedAt: zInstant.nullable(),
  syncVersion: z.string(),
  createdById: zUuidV7,
  createdAt: zInstant,
  updatedAt: zInstant,
  deletedAt: zInstant.nullable(),
  stops: z.array(adminTourStopResponseSchema),
  localizations: z.array(
    z.object({
      lang: z.string(),
      textReady: z.boolean(),
      stale: z.boolean(),
      translationSource: z.enum(TranslationSource),
    }),
  ),
  activationMissing: z.array(zTourGateMissing),
  liveStops: z.number().int(),
  hiddenFromTourists: z.boolean(),
});

/** One tour, as a staff member's page reads it. */
export class AdminTourResponseDto extends createZodDto(adminTourResponseSchema) {}

/** `{ tour }` — what the tour writes return. */
export const adminTourResultResponseSchema = z.object({ tour: adminTourResponseSchema });

/** What the tour writes return under `data`. */
export class AdminTourResultResponseDto extends createZodDto(adminTourResultResponseSchema) {}

/** The gate's answer to an activation request. */
export const tourActivationResultResponseSchema = z.object({
  status: z.enum(TourStatus),
  missing: z.array(zTourGateMissing),
});

/** What `POST /admin/tours/:id/activate` returns under `data`. */
export class TourActivationResultResponseDto extends createZodDto(
  tourActivationResultResponseSchema,
) {}
