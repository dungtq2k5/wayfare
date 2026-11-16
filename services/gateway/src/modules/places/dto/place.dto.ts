import {
  MAX_NEARBY_RADIUS_M,
  NEARBY_LIMIT_MAX,
  zCategoryCode,
  zPublicCode,
  zRequestedLanguage,
  zUuidV7,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A nearby answer's default radius and size. */
const DEFAULT_RADIUS_M = 1000;
const DEFAULT_LIMIT = 20;

const zCoordinate = (bound: number) => z.coerce.number().finite().min(-bound).max(bound);

/** `GET /places/nearby` query (api-endpoints-plan §2.1). */
export const nearbyPlacesQuerySchema = z
  .object({
    lat: zCoordinate(90),
    lng: zCoordinate(180),
    radiusM: z.coerce.number().int().min(1).max(MAX_NEARBY_RADIUS_M).default(DEFAULT_RADIUS_M),
    lang: zRequestedLanguage,
    categoryCode: zCategoryCode.optional(),
    limit: z.coerce.number().int().min(1).max(NEARBY_LIMIT_MAX).default(DEFAULT_LIMIT),
  })
  .strict();

/** Validated `GET /places/nearby` query. */
export class NearbyPlacesQueryDto extends createZodDto(nearbyPlacesQuerySchema) {}

/** `?lang=` of a detail read. */
export const placeLanguageQuerySchema = z.object({ lang: zRequestedLanguage }).strict();

/** Validated `?lang=`. */
export class PlaceLanguageQueryDto extends createZodDto(placeLanguageQuerySchema) {}

/** `/places/:id`. */
export const placeIdParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated Place path parameter. */
export class PlaceIdParamDto extends createZodDto(placeIdParamSchema) {}

/** `/places/by-code/:publicCode` — matched against the code format first. */
export const publicCodeParamSchema = z.object({ publicCode: zPublicCode }).strict();

/** Validated code path parameter. */
export class PublicCodeParamDto extends createZodDto(publicCodeParamSchema) {}
