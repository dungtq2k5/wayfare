import { zPublicCode, zRequestedLanguage, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `GET /tours` query (api-endpoints-plan §2.2): the area chosen on the map, cursor style. */
export const listToursQuerySchema = z
  .object({
    areaId: zUuidV7,
    lang: zRequestedLanguage,
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

/** Validated `GET /tours` query. */
export class TourListQueryDto extends createZodDto(listToursQuerySchema) {}

/** `?lang=` of a tour's read. */
export const tourLanguageQuerySchema = z.object({ lang: zRequestedLanguage }).strict();

/** Validated `?lang=`. */
export class TourLanguageQueryDto extends createZodDto(tourLanguageQuerySchema) {}

/** `/tours/:id`. */
export const tourIdParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated tour path parameter. */
export class TourIdParamDto extends createZodDto(tourIdParamSchema) {}

/** `/tours/by-code/:publicCode`. */
export const tourCodeParamSchema = z.object({ publicCode: zPublicCode }).strict();

/** Validated tour code parameter. */
export class TourCodeParamDto extends createZodDto(tourCodeParamSchema) {}
