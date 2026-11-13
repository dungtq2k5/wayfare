import {
  zPreviewInput,
  zPronunciationInput,
  zPronunciationQuery,
  zPronunciationUpdateInput,
  zUuidV7,
} from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `/admin/narration/pronunciations/:id`. */
export const pronunciationIdParamSchema = z.object({ id: zUuidV7 }).strict();

/** Validated entry path parameter. */
export class PronunciationIdParamDto extends createZodDto(pronunciationIdParamSchema) {}

/** `GET /admin/narration/pronunciations` query (api-endpoints-plan §4.4). */
export class PronunciationsQueryDto extends createZodDto(zPronunciationQuery) {}

/** Validated `POST /admin/narration/pronunciations` body. */
export class CreatePronunciationDto extends createZodDto(zPronunciationInput) {}

/** Validated `PATCH /admin/narration/pronunciations/:id` body: never the term. */
export class UpdatePronunciationDto extends createZodDto(zPronunciationUpdateInput) {}

/** Validated `POST /admin/narration/pronunciations/preview` body. */
export class PreviewPronunciationDto extends createZodDto(zPreviewInput) {}
