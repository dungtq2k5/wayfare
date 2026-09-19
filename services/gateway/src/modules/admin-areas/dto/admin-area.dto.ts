import { zAreaCreateInput, zAreaUpdateInput, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `/admin/areas/:id`. */
export const areaIdParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated area path parameter. */
export class AreaIdParamDto extends createZodDto(areaIdParamSchema) {}

/** Validated `POST /admin/areas` body (api-endpoints-plan §3.6): the boundary as GeoJSON. */
export class CreateAreaDto extends createZodDto(zAreaCreateInput) {}

/** Validated `PATCH /admin/areas/:id` body: any field but the code. */
export class UpdateAreaDto extends createZodDto(zAreaUpdateInput) {}
