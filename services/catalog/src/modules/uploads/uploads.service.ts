import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_PIXELS,
  newId,
  PENDING_UPLOAD_TTL_DAYS,
  UPLOAD_CONTENT_TYPES,
  UPLOAD_URL_TTL_MS,
  UploadPurpose,
  zPhotoVariants,
  zUuidV7,
} from '@wayfare/contracts';
import type { PhotoVariant, PhotoVariants } from '@wayfare/contracts';
import { uploadPurposeProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import {
  parseRpcRequest,
  requireAccountContext,
  requireProtoEnum,
  rpcError,
  toProtoTimestamp,
} from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import type { Env } from '../../config/env.schema';
import { IMAGE_PROCESSOR } from '../../providers/image/image-processor';
import type { ImageProcessor, ProcessedImage } from '../../providers/image/image-processor';
import { STORAGE_PROVIDER } from '@wayfare/nest-common/storage';
import type { StorageProvider } from '@wayfare/nest-common/storage';
import { PrismaService } from '../prisma/prisma.service';
import type { CatalogTx } from '../sync/sync.service';
import { sniffImage } from './domain/sniff-image';
import { CONFIRMED_UPLOAD_SELECT, toConfirmUploadResponse } from './upload.mapper';

/** How many confirms convert images at once in one process (rdm-spec C-12). */
export const MAX_CONCURRENT_CONFIRMS = 2;

/** Variants never change at a path, so caches may keep them forever (api-endpoints-plan §0.7). */
export const VARIANT_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Where an upload's original lands, generated server-side (rdm-spec C-12). */
export const originalPath = (uploadId: string) => `uploads/${uploadId}/original`;

/** Where a confirmed upload's variants live — immutable, content-bound paths. */
export const variantPath = (uploadId: string, variant: string) =>
  `photos/${uploadId}/${variant}.webp`;

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

const createFields = z.object({
  purpose: z.number(),
  contentType: z.string().max(64),
  bytes: z.number().int().min(1),
});

const confirmFields = z.object({ uploadId: zUuidV7 });

/** At most `limit` tasks at once; the rest wait their turn. */
class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next === undefined) this.active--;
      else next();
    }
  }
}

/**
 * Signed uploads (api-endpoints-plan §3.2, rdm-spec C-12): sign, then check and convert what
 * arrived. An upload is private to its uploader and usable once.
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly processing = new Semaphore(MAX_CONCURRENT_CONFIRMS);
  private readonly mediaBase: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(IMAGE_PROCESSOR) private readonly images: ImageProcessor,
  ) {
    this.mediaBase = config.get('GCS_PUBLIC_BASE_URL', { infer: true });
  }

  /** Records the upload and signs a `PUT` bound to its type and the size limit. */
  async createUpload(
    request: catalogGrpc.CreateUploadRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.CreateUploadResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(createFields, request);
    const purpose = requireProtoEnum(uploadPurposeProto, fields.purpose, '/purpose');
    // Tour covers arrive with tours.
    if (purpose !== UploadPurpose.PLACE_PHOTO) {
      throw rpcError('VALIDATION_FAILED', {
        issues: [{ path: '/purpose', code: 'invalid_value' }],
      });
    }
    const contentType = UPLOAD_CONTENT_TYPES.find((type) => type === fields.contentType);
    if (contentType === undefined) {
      throw rpcError('VALIDATION_FAILED', {
        issues: [{ path: '/contentType', code: 'invalid_value' }],
      });
    }
    if (fields.bytes > MAX_UPLOAD_BYTES) throw rpcError('UPLOAD_TOO_LARGE');

    const id = newId();
    const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_MS);
    await this.prisma.pendingUpload.create({
      data: {
        id,
        purpose,
        uploaderUserId: actor.userId,
        objectPath: originalPath(id),
        declaredContentType: contentType,
        maxBytes: MAX_UPLOAD_BYTES,
        expiresAt,
      },
      select: { id: true },
    });
    const signed = await this.storage.signUpload({
      objectPath: originalPath(id),
      contentType,
      maxBytes: MAX_UPLOAD_BYTES,
      expiresAt,
    });
    return {
      uploadId: id,
      uploadUrl: signed.url,
      expiresAt: toProtoTimestamp(expiresAt),
      requiredHeaders: { ...signed.requiredHeaders },
    };
  }

  /**
   * The development seed's way in (ADR 0002): what a browser's signed `PUT` would have stored is
   * written directly, then confirmed by the same path — sniffed, converted, original deleted.
   * Never reachable over gRPC. Returns the confirmed upload's id and its original's hash.
   */
  async importOriginal(
    context: RequestContext,
    file: { readonly bytes: Buffer; readonly contentType: string },
  ): Promise<{ uploadId: string; sha256: string }> {
    const actor = requireAccountContext(context);
    const contentType = UPLOAD_CONTENT_TYPES.find((type) => type === file.contentType);
    if (contentType === undefined) throw new Error(`not an upload type: ${file.contentType}`);
    if (file.bytes.length > MAX_UPLOAD_BYTES) throw rpcError('UPLOAD_TOO_LARGE');
    const id = newId();
    await this.prisma.pendingUpload.create({
      data: {
        id,
        purpose: UploadPurpose.PLACE_PHOTO,
        uploaderUserId: actor.userId,
        objectPath: originalPath(id),
        declaredContentType: contentType,
        maxBytes: MAX_UPLOAD_BYTES,
        expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_MS),
      },
      select: { id: true },
    });
    await this.storage.upload(originalPath(id), file.bytes, {
      contentType,
      cacheControl: 'private, no-store',
    });
    await this.confirmUpload({ uploadId: id }, context);
    return { uploadId: id, sha256: sha256(file.bytes) };
  }

  /**
   * Checks what arrived and converts it (rdm-spec C-12): present, within the size limit, the
   * declared type by its magic bytes, within the pixel limit; then three stripped WebP variants,
   * and the original — the only copy of the phone's EXIF — deleted. Idempotent once confirmed.
   */
  async confirmUpload(
    request: catalogGrpc.ConfirmUploadRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.ConfirmUploadResponse> {
    const actor = requireAccountContext(context);
    const { uploadId } = parseRpcRequest(confirmFields, request);
    const upload = await this.prisma.pendingUpload.findUnique({ where: { id: uploadId } });
    // Someone else's upload is indistinguishable from a missing one.
    if (upload?.uploaderUserId !== actor.userId) {
      throw rpcError('UPLOAD_NOT_READY');
    }
    if (upload.confirmedAt !== null) {
      return toConfirmUploadResponse(upload, this.mediaBase);
    }
    if (upload.expiresAt.getTime() <= Date.now()) throw rpcError('UPLOAD_NOT_READY');

    const stored = await this.storage.stat(upload.objectPath);
    if (stored === null) throw rpcError('UPLOAD_NOT_READY');
    // The emulator does not enforce the signed range; this check is the guard there.
    if (stored.bytes > upload.maxBytes) return this.refuse(upload.objectPath, 'UPLOAD_TOO_LARGE');

    const original = await this.storage.download(upload.objectPath);
    if (original.length > upload.maxBytes)
      return this.refuse(upload.objectPath, 'UPLOAD_TOO_LARGE');
    if (sniffImage(original) !== upload.declaredContentType) {
      return this.refuse(upload.objectPath, 'UPLOAD_TYPE_MISMATCH');
    }

    const processed: ProcessedImage = await this.processing.run(() =>
      this.images.toVariants(original, MAX_UPLOAD_PIXELS),
    );
    if (!processed.ok) {
      return this.refuse(
        upload.objectPath,
        processed.reason === 'TOO_LARGE' ? 'UPLOAD_TOO_LARGE' : 'UPLOAD_TYPE_MISMATCH',
      );
    }
    const storedVariants: Partial<Record<keyof PhotoVariants, PhotoVariant>> = {};
    for (const variant of processed.variants) {
      const objectPath = variantPath(upload.id, variant.name);
      await this.storage.upload(objectPath, variant.data, {
        contentType: 'image/webp',
        cacheControl: VARIANT_CACHE_CONTROL,
      });
      storedVariants[variant.name] = {
        objectPath,
        sha256: sha256(variant.data),
        bytes: variant.data.length,
        width: variant.width,
        height: variant.height,
      };
    }
    const variants = zPhotoVariants.parse(storedVariants);

    await this.prisma.pendingUpload.updateMany({
      where: { id: upload.id, confirmedAt: null },
      data: {
        sniffedContentType: upload.declaredContentType,
        bytes: original.length,
        sha256: sha256(original),
        variants,
        confirmedAt: new Date(),
      },
    });
    try {
      await this.storage.delete(upload.objectPath);
    } catch (error) {
      // The reap job removes a confirmed upload's leftover original.
      this.logger.warn(
        { uploadId: upload.id, err: error instanceof Error ? error.message : 'unknown' },
        'could not delete an upload original',
      );
    }
    const confirmed = await this.prisma.pendingUpload.findUniqueOrThrow({
      where: { id: upload.id },
      select: CONFIRMED_UPLOAD_SELECT,
    });
    return toConfirmUploadResponse(confirmed, this.mediaBase);
  }

  /**
   * Turns a confirmed upload into a photo (rdm-spec C-12, api-endpoints-plan §3.5): the same
   * uploader and purpose, confirmed, unused and not yet due for reaping — or, for an approval,
   * whatever its age; else `UPLOAD_NOT_READY`.
   */
  async consumeUpload(
    tx: CatalogTx,
    uploadId: string,
    uploaderUserId: string,
    purpose: UploadPurpose,
    options: { readonly anyAge?: boolean } = {},
  ): Promise<{ sha256: string; variants: PhotoVariants }> {
    // An upload a pending submission names is kept past the TTL (rdm-spec C-12): its approval
    // consumes it whatever its age.
    const maxAgeDays = options.anyAge === true ? null : PENDING_UPLOAD_TTL_DAYS;
    const [row] = await tx.$queryRaw<{ sha256: string; variants: unknown }[]>`
      UPDATE pending_uploads
      SET consumed_at = now()
      WHERE id = ${uploadId}::uuid
        AND uploader_user_id = ${uploaderUserId}::uuid
        AND purpose = ${purpose}
        AND confirmed_at IS NOT NULL
        AND (${maxAgeDays}::int IS NULL
          OR confirmed_at > now() - make_interval(days => ${maxAgeDays}::int))
        AND consumed_at IS NULL
      RETURNING sha256, variants`;
    if (row === undefined) throw rpcError('UPLOAD_NOT_READY');
    return { sha256: row.sha256, variants: zPhotoVariants.parse(row.variants) };
  }

  private async refuse(
    objectPath: string,
    code: 'UPLOAD_TOO_LARGE' | 'UPLOAD_TYPE_MISMATCH',
  ): Promise<never> {
    await this.storage.delete(objectPath);
    throw rpcError(code);
  }
}
