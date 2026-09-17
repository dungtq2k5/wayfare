import { MAX_UPLOAD_BYTES, newId } from '@wayfare/contracts';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';
import { errorOf, staff } from '../setup/fixtures';
import { hugeCanvasPng, oversized, phoneJpeg, smallPng, smallWebp } from '../setup/images';
import { catalogServices } from '../setup/services';

const prisma = testPrisma();
const { uploads, storage } = catalogServices(prisma);
const PHOTO = catalogGrpc.UploadPurpose.UPLOAD_PURPOSE_PLACE_PHOTO;

beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

/** Signs an upload and PUTs `data` to it, as a browser would. */
async function upload(
  actor: ReturnType<typeof staff>,
  contentType: string,
  data: Buffer,
): Promise<string> {
  const signed = await uploads.createUpload(
    { purpose: PHOTO, contentType, bytes: Math.min(data.length, MAX_UPLOAD_BYTES) },
    actor,
  );
  const response = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: signed.requiredHeaders,
    body: new Uint8Array(data),
  });
  expect(response.status).toBe(200);
  return signed.uploadId;
}

const download = async (url: string) => Buffer.from(await (await fetch(url)).arrayBuffer());

describe('CreateUpload', () => {
  it('records the upload and signs a PUT bound to its type and size', async () => {
    const actor = staff();
    const signed = await uploads.createUpload(
      { purpose: PHOTO, contentType: 'image/jpeg', bytes: 1000 },
      actor,
    );
    expect(signed.requiredHeaders).toEqual({
      'Content-Type': 'image/jpeg',
      'x-goog-content-length-range': `0,${MAX_UPLOAD_BYTES}`,
    });
    expect(signed.uploadUrl).toContain(`/uploads/${signed.uploadId}/original`);
    expect(signed.uploadUrl).toContain('X-Goog-Signature=');
    const row = await prisma.pendingUpload.findUniqueOrThrow({ where: { id: signed.uploadId } });
    expect(row).toMatchObject({
      uploaderUserId: actor.userId,
      purpose: 'PLACE_PHOTO',
      objectPath: `uploads/${signed.uploadId}/original`,
      declaredContentType: 'image/jpeg',
      maxBytes: MAX_UPLOAD_BYTES,
    });
    const ttl = row.expiresAt.getTime() - row.createdAt.getTime();
    expect(ttl).toBeGreaterThan(14 * 60 * 1000);
    expect(ttl).toBeLessThan(16 * 60 * 1000);
  });

  it('refuses HEIC, an oversized declaration, and a tour cover', async () => {
    const actor = staff();
    const refuse = async (request: catalogGrpc.CreateUploadRequest) =>
      (await errorOf(uploads.createUpload(request, actor))).code;
    expect(await refuse({ purpose: PHOTO, contentType: 'image/heic', bytes: 10 })).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      await refuse({ purpose: PHOTO, contentType: 'image/png', bytes: MAX_UPLOAD_BYTES + 1 }),
    ).toBe('UPLOAD_TOO_LARGE');
    expect(
      await refuse({
        purpose: catalogGrpc.UploadPurpose.UPLOAD_PURPOSE_TOUR_COVER,
        contentType: 'image/png',
        bytes: 10,
      }),
    ).toBe('VALIDATION_FAILED');
    expect(await refuse({ purpose: 0, contentType: 'image/png', bytes: 10 })).toBe(
      'VALIDATION_FAILED',
    );
    expect(await prisma.pendingUpload.count()).toBe(0);
  });
});

describe('ConfirmUpload', () => {
  it('writes three stripped, oriented WebP variants and deletes the GPS-tagged original', async () => {
    const actor = staff();
    const original = await phoneJpeg();
    const sent = await sharp(original).metadata();
    expect([sent.orientation, Boolean(sent.exif), Boolean(sent.icc)]).toEqual([6, true, true]);
    const uploadId = await upload(actor, 'image/jpeg', original);
    const confirmed = await uploads.confirmUpload({ uploadId }, actor);
    expect(confirmed.uploadId).toBe(uploadId);
    const { thumb, card, full } = confirmed.variants!;
    // Orientation 6 applied: portrait now.
    expect([thumb!.width, thumb!.height]).toEqual([240, 320]);
    expect([card!.width, card!.height]).toEqual([600, 800]);
    expect([full!.width, full!.height]).toEqual([900, 1200]);
    for (const variant of [thumb!, card!, full!]) {
      const data = await download(variant.url);
      expect(data.length).toBe(variant.bytes);
      const metadata = await sharp(data).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
      expect(data.includes(Buffer.from('PhoneCo'))).toBe(false);
    }
    expect(await storage.stat(`uploads/${uploadId}/original`)).toBeNull();
    const row = await prisma.pendingUpload.findUniqueOrThrow({ where: { id: uploadId } });
    expect(row).toMatchObject({ sniffedContentType: 'image/jpeg', bytes: original.length });
    expect(row.confirmedAt).not.toBeNull();
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);

    // Idempotent once confirmed, even with the original gone.
    expect(await uploads.confirmUpload({ uploadId }, actor)).toEqual(confirmed);
  });

  it('accepts a WebP as itself', async () => {
    const actor = staff();
    const uploadId = await upload(actor, 'image/webp', await smallWebp());
    const confirmed = await uploads.confirmUpload({ uploadId }, actor);
    // Never enlarged.
    expect([confirmed.variants!.full!.width, confirmed.variants!.full!.height]).toEqual([400, 300]);
  });

  it('refuses a PNG declared as JPEG, and deletes it', async () => {
    const actor = staff();
    const uploadId = await upload(actor, 'image/jpeg', await smallPng());
    expect((await errorOf(uploads.confirmUpload({ uploadId }, actor))).code).toBe(
      'UPLOAD_TYPE_MISMATCH',
    );
    expect(await storage.stat(`uploads/${uploadId}/original`)).toBeNull();
    expect(
      (await prisma.pendingUpload.findUniqueOrThrow({ where: { id: uploadId } })).confirmedAt,
    ).toBeNull();
  });

  it('refuses an object over 5 MB the emulator let through, and deletes it', async () => {
    const actor = staff();
    const uploadId = await upload(actor, 'image/jpeg', oversized(6 * 1024 * 1024));
    expect((await errorOf(uploads.confirmUpload({ uploadId }, actor))).code).toBe(
      'UPLOAD_TOO_LARGE',
    );
    expect(await storage.stat(`uploads/${uploadId}/original`)).toBeNull();
  });

  it('refuses a PNG declaring 60 MP before decoding it', async () => {
    const actor = staff();
    const uploadId = await upload(actor, 'image/png', hugeCanvasPng(10_000, 6_000));
    expect((await errorOf(uploads.confirmUpload({ uploadId }, actor))).code).toBe(
      'UPLOAD_TOO_LARGE',
    );
    expect(await storage.stat(`uploads/${uploadId}/original`)).toBeNull();
  });

  it('refuses bytes that carry a signature but no image', async () => {
    const actor = staff();
    const uploadId = await upload(actor, 'image/jpeg', oversized(1000));
    expect((await errorOf(uploads.confirmUpload({ uploadId }, actor))).code).toBe(
      'UPLOAD_TYPE_MISMATCH',
    );
  });

  it('is not ready before the PUT, for someone else, when expired, or when unknown', async () => {
    const actor = staff();
    const signed = await uploads.createUpload(
      { purpose: PHOTO, contentType: 'image/png', bytes: 10 },
      actor,
    );
    const code = async (uploadId: string, caller = actor) =>
      (await errorOf(uploads.confirmUpload({ uploadId }, caller))).code;
    expect(await code(signed.uploadId)).toBe('UPLOAD_NOT_READY');
    const uploadId = await upload(actor, 'image/png', await smallPng());
    expect(await code(uploadId, staff())).toBe('UPLOAD_NOT_READY');
    expect(await code(newId())).toBe('UPLOAD_NOT_READY');
    await prisma.pendingUpload.update({
      where: { id: uploadId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await code(uploadId)).toBe('UPLOAD_NOT_READY');
  });

  it('converts two at a time, and all of them finish', async () => {
    const actor = staff();
    const ids = await Promise.all(
      Array.from({ length: 4 }, async () => upload(actor, 'image/png', await smallPng())),
    );
    const results = await Promise.all(
      ids.map((uploadId) => uploads.confirmUpload({ uploadId }, actor)),
    );
    expect(results.map((result) => result.uploadId)).toEqual(ids);
  });
});
