import {
  PlaceKind,
  PlaceStatus,
  zBooleanParam,
  zCategoryCode,
  zCreatePlaceInput,
  zDeactivatePlaceInput,
  zMenuInput,
  zOpeningHours,
  zPageQuery,
  zPhotoItems,
  zPlaceContentInput,
  zUpdateEditorialInput,
  zUuidV7,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

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

/** `POST /admin/places` body (api-endpoints-plan §3.5). */
export const createPlaceBodySchema = zCreatePlaceInput;

/** Validated `POST /admin/places` body. */
export class CreatePlaceDto extends createZodDto(createPlaceBodySchema) {}

/**
 * `PATCH /admin/places/:id` body: content fields only, the submission payload's shape (rdm-spec
 * §1.4). `null` clears an optional field.
 */
export const updatePlaceBodySchema = zPlaceContentInput.partial().strict();

/** Validated `PATCH /admin/places/:id` body. */
export class UpdatePlaceDto extends createZodDto(updatePlaceBodySchema) {}

/** `PATCH /admin/places/:id/editorial` body. */
export const updateEditorialBodySchema = zUpdateEditorialInput;

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

/** `POST /admin/places/:id/deactivate` body. */
export const deactivatePlaceBodySchema = zDeactivatePlaceInput;

/** Validated `POST /admin/places/:id/deactivate` body. */
export class DeactivatePlaceDto extends createZodDto(deactivatePlaceBodySchema) {}
