import {
  TourStatus,
  zBooleanParam,
  zPageQuery,
  zTourCreateInput,
  zTourStopsInput,
  zTourUpdateInput,
  zUuidV7,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `GET /admin/tours` query (api-endpoints-plan §3.6). `q` matches the title or the code. */
export const listToursQuerySchema = zPageQuery({
  sort: ['updatedAt', 'createdAt', 'titleVi'],
  defaultSort: '-updatedAt',
  search: true,
}).extend({
  status: z.enum(TourStatus).optional(),
  areaId: zUuidV7.optional(),
  includeDeleted: zBooleanParam,
});

/** Validated `GET /admin/tours` query. */
export class ListToursQueryDto extends createZodDto(listToursQuerySchema) {}

/** `/admin/tours/:id`. */
export const adminTourIdParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated tour path parameter. */
export class AdminTourIdParamDto extends createZodDto(adminTourIdParamSchema) {}

/** Validated `POST /admin/tours` body. */
export class CreateTourDto extends createZodDto(zTourCreateInput) {}

/** Validated `PATCH /admin/tours/:id` body. */
export class UpdateTourDto extends createZodDto(zTourUpdateInput) {}

/** Validated `PUT /admin/tours/:id/stops` body. */
export class ReplaceTourStopsDto extends createZodDto(zTourStopsInput) {}
