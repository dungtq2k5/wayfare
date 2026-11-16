import { zRequestedLanguage, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `/offline/areas/:areaId/…`. */
export const offlineAreaParamSchema = z.object({ areaId: zUuidV7 }).strict();

/** Validated offline area path parameter. */
export class OfflineAreaParamDto extends createZodDto(offlineAreaParamSchema) {}

/** `GET /offline/areas/:areaId/manifest` query (api-endpoints-plan §2.4). */
export const manifestQuerySchema = z.object({ lang: zRequestedLanguage }).strict();

/** Validated manifest query. */
export class ManifestQueryDto extends createZodDto(manifestQuerySchema) {}

/** A version a device sends back: a non-negative safe integer, as a string. */
const zVersion = z
  .string()
  .regex(/^\d{1,16}$/)
  .refine((value) => Number.isSafeInteger(Number(value)), { message: 'Too large' });

/** `GET /offline/areas/:areaId/manifest/diff` query: what the device holds. */
export const manifestDiffQuerySchema = z
  .object({
    lang: zRequestedLanguage,
    fromDatasetVersion: zVersion,
    fromMapPackVersion: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();

/** Validated manifest diff query. */
export class ManifestDiffQueryDto extends createZodDto(manifestDiffQuerySchema) {}
