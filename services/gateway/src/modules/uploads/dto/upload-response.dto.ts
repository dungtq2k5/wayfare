import { zPhotoView, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A signed upload: PUT the file to `uploadUrl` with exactly `requiredHeaders`. */
export const createUploadResponseSchema = z.object({
  uploadId: zUuidV7,
  uploadUrl: z.url(),
  expiresAt: z.iso.datetime({ offset: true }),
  requiredHeaders: z.record(z.string(), z.string()),
});

/** What `POST /uploads` returns under `data`. */
export class CreateUploadResponseDto extends createZodDto(createUploadResponseSchema) {}

/** A confirmed upload, for the editor's preview. */
export const confirmUploadResponseSchema = z.object({
  uploadId: zUuidV7,
  variants: z.object({ thumb: zPhotoView, card: zPhotoView, full: zPhotoView }),
});

/** What `POST /uploads/:uploadId/confirm` returns under `data`. */
export class ConfirmUploadResponseDto extends createZodDto(confirmUploadResponseSchema) {}
