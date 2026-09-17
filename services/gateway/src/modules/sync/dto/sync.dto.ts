import { zRequestedLanguage, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A sync position a client sends back: a non-negative safe integer, as a string. */
const zSince = z
  .string()
  .regex(/^\d{1,16}$/)
  .refine((value) => Number.isSafeInteger(Number(value)), { message: 'Too large' });

/** `GET /sync/places` query (api-endpoints-plan §2.1). `since` omitted is a full snapshot. */
export const syncPlacesQuerySchema = z
  .object({ areaId: zUuidV7, lang: zRequestedLanguage, since: zSince.optional() })
  .strict();

/** Validated `GET /sync/places` query. */
export class SyncPlacesQueryDto extends createZodDto(syncPlacesQuerySchema) {}
