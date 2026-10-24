import { z } from 'zod';
import { zUuidV7 } from '../common/ids';
import { MAX_PHOTOS_PER_PLACE } from '../entitlements/ceilings';
import { MAX_ADMIN_REASON_LENGTH } from '../identity/limits';
import {
  MAX_TRIGGER_RADIUS_M,
  MIN_TRIGGER_RADIUS_M,
  NARRATION_PRIORITY_MAX,
  NARRATION_PRIORITY_MIN,
} from '../narration/narration-config';
import { zOpeningHours, zPhotoSetItem, zPlaceContentInput } from './schemas';

/*
 * The staff Place forms' bodies (api-endpoints-plan §3.5), shared by the gateway, which validates
 * them, and the console, which checks a form against the same limits before sending.
 */

/** How near a tourist hears a Place, in metres. */
export const zTriggerRadius = z.number().int().min(MIN_TRIGGER_RADIUS_M).max(MAX_TRIGGER_RADIUS_M);

/** Which of two overlapping Places plays first. */
export const zNarrationPriority = z
  .number()
  .int()
  .min(NARRATION_PRIORITY_MIN)
  .max(NARRATION_PRIORITY_MAX);

/** A Place's ordered photo set: kept photos and new uploads. */
export const zPhotoItems = z.array(zPhotoSetItem).max(MAX_PHOTOS_PER_PLACE);

/**
 * `POST /admin/places`: an Editorial Place. New photos are confirmed uploads; `requestActivation`
 * starts `PROCESSING`, else `DRAFT`. A menu is a Venue's, sent after.
 */
export const zCreatePlaceInput = zPlaceContentInput.extend({
  triggerRadiusM: zTriggerRadius,
  narrationPriority: zNarrationPriority,
  photos: z
    .array(z.object({ uploadId: zUuidV7, altTextVi: zPhotoSetItem.shape.altTextVi }).strict())
    .max(MAX_PHOTOS_PER_PLACE)
    .default([]),
  openingHours: zOpeningHours.default([]),
  requestActivation: z.boolean(),
});

/** `PATCH /admin/places/:id/editorial` — the only route besides approval that writes these. */
export const zUpdateEditorialInput = z
  .object({
    triggerRadiusM: zTriggerRadius.optional(),
    narrationPriority: zNarrationPriority.optional(),
  })
  .strict();

/** `POST /admin/places/:id/deactivate`; the reason is kept in the audit row only. */
export const zDeactivatePlaceInput = z
  .object({ reason: z.string().trim().min(1).max(MAX_ADMIN_REASON_LENGTH) })
  .strict();
