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
 * Why a file can't be uploaded, before anything is sent — the API's own limits — or `null`. A HEIC
 * photo is refused, not converted (round 36's K9): an iPhone's picker already sends JPEG.
 */
export function photoRefusal(file: {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}): UploadRefused | null {
  if (/^image\/hei[cf]$/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
    return new UploadRefused('UPLOAD_HEIC');
  }
  if (!(UPLOAD_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    return new UploadRefused('UPLOAD_TYPE_MISMATCH');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return new UploadRefused('UPLOAD_TOO_LARGE', {
      size: Math.round((file.size / 1024 / 1024) * 10) / 10,
    });
  }
  return null;
}

/** The storage `PUT`, reporting how much has gone (F4's percent). */
function put(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (percent: number) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => resolve(request.status >= 200 && request.status < 300);
    request.onerror = () => resolve(false);
    request.send(file);
  });
}

/**
 * One photo through §3.2's uploads (K4): checked here first against the same limits the API holds,
 * signed, `PUT` straight to storage with exactly the headers it asks for, then confirmed — before
 * the form's save, which then names it by `uploadId`.
 */
export async function uploadPhoto(
  file: File,
  onProgress: (percent: number) => void = () => undefined,
): Promise<FormPhoto> {
  const refused = photoRefusal(file);
  if (refused !== null) throw refused;
  const { data: signed } = await uploadsCreate({
    purpose: 'PLACE_PHOTO',
    contentType: file.type as (typeof UPLOAD_CONTENT_TYPES)[number],
    bytes: file.size,
  });
  if (!(await put(signed.uploadUrl, signed.requiredHeaders, file, onProgress))) {
    throw new UploadRefused('UPLOAD_NOT_READY');
  }
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
