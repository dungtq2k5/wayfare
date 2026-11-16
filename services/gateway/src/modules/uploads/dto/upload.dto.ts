import { UPLOAD_CONTENT_TYPES, UploadPurpose, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * `POST /uploads` body (api-endpoints-plan §3.2). The size limit is catalog's to enforce: a
 * larger declaration is `422 UPLOAD_TOO_LARGE`, not a validation failure.
 */
export const createUploadBodySchema = z
  .object({
    purpose: z.enum(UploadPurpose),
    contentType: z.enum(UPLOAD_CONTENT_TYPES),
    bytes: z.number().int().min(1).max(2_147_483_647),
  })
  .strict();

/** Validated `POST /uploads` body. */
export class CreateUploadDto extends createZodDto(createUploadBodySchema) {}

/** `/uploads/:uploadId`. */
export const uploadIdParamSchema = z.object({ uploadId: zUuidV7 }).strict();

/** Validated upload path parameter. */
export class UploadIdParamDto extends createZodDto(uploadIdParamSchema) {}
