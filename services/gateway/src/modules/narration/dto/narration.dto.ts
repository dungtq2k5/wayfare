import { zOnDemandRequest, zRequestedLanguage, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `POST /narration/on-demand` body (api-endpoints-plan §4.1). */
export class OnDemandDto extends createZodDto(zOnDemandRequest) {}

/** `/narration/places/:placeId/status`. */
export const narrationPlaceParamSchema = z.object({ placeId: zUuidV7 }).strict();

/** Validated Place path parameter. */
export class NarrationPlaceParamDto extends createZodDto(narrationPlaceParamSchema) {}

/** `?lang=` of the status read. */
export const narrationStatusQuerySchema = z.object({ lang: zRequestedLanguage }).strict();

/** Validated `?lang=`. */
export class NarrationStatusQueryDto extends createZodDto(narrationStatusQuerySchema) {}
