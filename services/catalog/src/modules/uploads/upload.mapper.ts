import type { catalogGrpc } from '@wayfare/contracts/grpc';
import type { Prisma } from '../../../generated/prisma/client';
import { toPhotoVariantViews } from '../places/place.mapper';

/** A confirmed upload, as confirm answers it. */
export const CONFIRMED_UPLOAD_SELECT = {
  id: true,
  variants: true,
} as const satisfies Prisma.PendingUploadSelect;

/** A row as `CONFIRMED_UPLOAD_SELECT` loads it. */
export type ConfirmedUploadRow = Prisma.PendingUploadGetPayload<{
  select: typeof CONFIRMED_UPLOAD_SELECT;
}>;

/** The editor's preview of a confirmed upload. */
export function toConfirmUploadResponse(
  row: ConfirmedUploadRow,
  mediaBase: string,
): catalogGrpc.ConfirmUploadResponse {
  return {
    uploadId: row.id,
    variants: toPhotoVariantViews(row.variants ?? null, mediaBase),
  };
}
