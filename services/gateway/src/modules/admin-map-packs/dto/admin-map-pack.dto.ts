import { zRegisterMapPackInput, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `/admin/map-packs/:id`. */
export const mapPackIdParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated map pack path parameter. */
export class MapPackIdParamDto extends createZodDto(mapPackIdParamSchema) {}

/** `GET /admin/map-packs` query. */
export const mapPacksQuerySchema = z.object({ areaId: zUuidV7.optional() }).strict();

/** Validated `GET /admin/map-packs` query. */
export class MapPacksQueryDto extends createZodDto(mapPacksQuerySchema) {}

/** Validated `POST /admin/map-packs` body (api-endpoints-plan §3.6): every object with its hash. */
export class RegisterMapPackDto extends createZodDto(zRegisterMapPackInput) {}
