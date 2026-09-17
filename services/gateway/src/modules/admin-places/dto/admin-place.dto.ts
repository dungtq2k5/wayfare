import {
  MAX_ADMIN_REASON_LENGTH,
  MAX_PHOTOS_PER_PLACE,
  MAX_TRIGGER_RADIUS_M,
  MIN_TRIGGER_RADIUS_M,
  NARRATION_PRIORITY_MAX,
  NARRATION_PRIORITY_MIN,
  PlaceKind,
  PlaceStatus,
  zBooleanParam,
  zCategoryCode,
  zMenuInput,
  zOpeningHours,
  zPageQuery,
  zPhotoSetItem,
  zPlaceContentInput,
  zUuidV7,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const zTriggerRadius = z.number().int().min(MIN_TRIGGER_RADIUS_M).max(MAX_TRIGGER_RADIUS_M);
const zNarrationPriority = z.number().int().min(NARRATION_PRIORITY_MIN).max(NARRATION_PRIORITY_MAX);
const zPhotoItems = z.array(zPhotoSetItem).max(MAX_PHOTOS_PER_PLACE);

/** `GET /admin/places` query (api-endpoints-plan §3.5). `q` matches the name or the code. */
export const listPlacesQuerySchema = zPageQuery({
  sort: ['updatedAt', 'createdAt', 'nameVi'],
  defaultSort: '-updatedAt',
  search: true,
}).extend({
  kind: z.enum(PlaceKind).optional(),
  status: z.enum(PlaceStatus).optional(),
  areaId: zUuidV7.optional(),
  categoryCode: zCategoryCode.optional(),
  ownerUserId: zUuidV7.optional(),
  includeDeleted: zBooleanParam,
});

/** Validated `GET /admin/places` query. */
export class ListPlacesQueryDto extends createZodDto(listPlacesQuerySchema) {}

/** `/admin/places/:id`. */
export const adminPlaceIdParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated Place path parameter. */
export class AdminPlaceIdParamDto extends createZodDto(adminPlaceIdParamSchema) {}

/**
 * `POST /admin/places` body: an Editorial Place (api-endpoints-plan §3.5). New photos are
 * confirmed uploads; `requestActivation` starts `PROCESSING`, else `DRAFT`.
 */
export const createPlaceBodySchema = zPlaceContentInput.extend({
  triggerRadiusM: zTriggerRadius,
  narrationPriority: zNarrationPriority,
  photos: z
    .array(z.object({ uploadId: zUuidV7, altTextVi: zPhotoSetItem.shape.altTextVi }).strict())
    .max(MAX_PHOTOS_PER_PLACE)
    .default([]),
  openingHours: zOpeningHours.default([]),
  requestActivation: z.boolean(),
});

/** Validated `POST /admin/places` body. */
export class CreatePlaceDto extends createZodDto(createPlaceBodySchema) {}

/**
 * `PATCH /admin/places/:id` body: content fields only, the submission payload's shape (rdm-spec
 * §1.4). `null` clears an optional field.
 */
export const updatePlaceBodySchema = zPlaceContentInput.partial().strict();

/** Validated `PATCH /admin/places/:id` body. */
export class UpdatePlaceDto extends createZodDto(updatePlaceBodySchema) {}

/** `PATCH /admin/places/:id/editorial` body — the only route besides approval that writes these. */
export const updateEditorialBodySchema = z
  .object({
    triggerRadiusM: zTriggerRadius.optional(),
    narrationPriority: zNarrationPriority.optional(),
  })
  .strict();

/** Validated `PATCH /admin/places/:id/editorial` body. */
export class UpdateEditorialDto extends createZodDto(updateEditorialBodySchema) {}

/** `PUT /admin/places/:id/photos` body: the ordered set, kept photos and new uploads. */
export const replacePhotosBodySchema = z.object({ items: zPhotoItems }).strict();

/** Validated `PUT /admin/places/:id/photos` body. */
export class ReplacePhotosDto extends createZodDto(replacePhotosBodySchema) {}

/** `PUT /admin/places/:id/menu` body: one currency, every price within its ceiling (ADR 0046). */
export const replaceMenuBodySchema = zMenuInput;

/** Validated `PUT /admin/places/:id/menu` body. */
export class ReplaceMenuDto extends createZodDto(replaceMenuBodySchema) {}

/** `PUT /admin/places/:id/opening-hours` body: the whole list (rdm-spec C-16). */
export const replaceOpeningHoursBodySchema = z.object({ items: zOpeningHours }).strict();

/** Validated `PUT /admin/places/:id/opening-hours` body. */
export class ReplaceOpeningHoursDto extends createZodDto(replaceOpeningHoursBodySchema) {}

/** `POST /admin/places/:id/deactivate` body; the reason is kept in the audit row only. */
export const deactivatePlaceBodySchema = z
  .object({ reason: z.string().trim().min(1).max(MAX_ADMIN_REASON_LENGTH) })
  .strict();

/** Validated `POST /admin/places/:id/deactivate` body. */
export class DeactivatePlaceDto extends createZodDto(deactivatePlaceBodySchema) {}
