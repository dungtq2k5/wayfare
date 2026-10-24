'use client';

import { ApiError, uploadsConfirm, uploadsCreate } from '@wayfare/api-client';
import { MAX_UPLOAD_BYTES, UPLOAD_CONTENT_TYPES } from '@wayfare/contracts';

/** A photo the form holds: one already on the Place, or a new confirmed upload. */
export type FormPhoto =
  | { readonly key: string; readonly photoId: string; readonly preview: string; altTextVi: string }
  | {
      readonly key: string;
      readonly uploadId: string;
      readonly preview: string;
      altTextVi: string;
    };

/** Why a file was refused before or while uploading, as an API code with its details. */
export class UploadRefused extends Error {
  constructor(
    readonly code: string,
    readonly details: Record<string, string | number> = {},
  ) {
    super(code);
  }
}

/**
 * One photo through §3.2's uploads (K4): checked here first against the same limits the API holds,
 * signed, `PUT` straight to storage with exactly the headers it asks for, then confirmed — before
 * the form's save, which then names it by `uploadId`.
 */
export async function uploadPhoto(file: File): Promise<FormPhoto> {
  if (!(UPLOAD_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    throw new UploadRefused('UPLOAD_TYPE_MISMATCH');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadRefused('UPLOAD_TOO_LARGE', {
      size: Math.round((file.size / 1024 / 1024) * 10) / 10,
    });
  }
  const { data: signed } = await uploadsCreate({
    purpose: 'PLACE_PHOTO',
    contentType: file.type as (typeof UPLOAD_CONTENT_TYPES)[number],
    bytes: file.size,
  });
  const put = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: signed.requiredHeaders,
    body: file,
  });
  if (!put.ok) throw new UploadRefused('UPLOAD_NOT_READY');
  try {
    const { data } = await uploadsConfirm(signed.uploadId);
    return {
      key: signed.uploadId,
      uploadId: signed.uploadId,
      preview: data.variants.thumb.url,
      altTextVi: '',
    };
  } catch (error) {
    if (error instanceof ApiError) throw new UploadRefused(error.code);
    throw error;
  }
}
