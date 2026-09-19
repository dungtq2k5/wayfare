import {
  AudioStatus,
  PlaceInactiveReason,
  PlaceStatus,
  SubmissionKind,
  zOwnerLimits,
  zPhotoView,
  zUuidV7,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { adminPlaceResponseSchema } from '../../admin-places/dto/admin-place-response.dto';
import { submissionResponseSchema } from '../../owner-submissions/dto/owner-submission-response.dto';

const zInstant = z.iso.datetime({ offset: true });

/** One row of the owner's Venue list (api-endpoints-plan §3.1). */
export const ownerPlaceResponseSchema = z.object({
  id: zUuidV7,
  publicCode: z.string(),
  nameVi: z.string(),
  categoryCode: z.string(),
  status: z.enum(PlaceStatus),
  inactiveReason: z.enum(PlaceInactiveReason).nullable(),
  autoNarration: z.boolean(),
  /** Discovery boosts arrive with their own doc; until then, none. */
  boosted: z.null(),
  cover: zPhotoView.nullable(),
  localizations: z.array(
    z.object({
      lang: z.string(),
      textReady: z.boolean(),
      stale: z.boolean(),
      audioStatus: z.enum(AudioStatus),
      audioStale: z.boolean(),
    }),
  ),
  pendingSubmission: z
    .object({ id: zUuidV7, kind: z.enum(SubmissionKind), submittedAt: zInstant })
    .nullable(),
  updatedAt: zInstant,
});

/** One owner Venue row. */
export class OwnerPlaceResponseDto extends createZodDto(ownerPlaceResponseSchema) {}

/**
 * `GET /owner/places/:id`: what tourists see and what is waiting, side by side, with the hash an
 * `UPDATE` sends back as its base.
 */
export const ownerPlaceDetailResponseSchema = z.object({
  place: adminPlaceResponseSchema,
  editableHash: z.string().regex(/^[0-9a-f]{64}$/),
  pendingSubmission: submissionResponseSchema.nullable(),
});

/** One owner Venue in full. */
export class OwnerPlaceDetailResponseDto extends createZodDto(ownerPlaceDetailResponseSchema) {}

/** `GET /owner/places/limits`. */
export const ownerLimitsResponseSchema = zOwnerLimits;

/** The owner's effective limits and their use. */
export class OwnerLimitsResponseDto extends createZodDto(ownerLimitsResponseSchema) {}

/** `{ place }` — what deactivate and reactivate return. */
export const ownerPlaceResultResponseSchema = z.object({ place: adminPlaceResponseSchema });

/** `{ place }`. */
export class OwnerPlaceResultResponseDto extends createZodDto(ownerPlaceResultResponseSchema) {}
