import { compareStrings, newId } from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { StorageProvider } from '@wayfare/nest-common/storage';
import { testPrisma, truncateAll } from '../setup/database';
import { confirmedUpload } from '../setup/fixtures';
import { catalogServices, testStorage } from '../setup/services';

const prisma = testPrisma();
const storage = testStorage();
const { reap, cleanup } = catalogServices(prisma, { storage });
const DAY = 24 * 60 * 60 * 1000;
const put = (path: string) =>
  storage.upload(path, Buffer.from('x'), { contentType: 'image/webp', cacheControl: 'no-store' });
const exists = async (path: string) => (await storage.stat(path)) !== null;

/** The emulator, except that every delete fails. */
function withFailingDelete(message: string): StorageProvider {
  return Object.assign(Object.create(storage) as StorageProvider, {
    delete: () => Promise.reject(new Error(message)),
  });
}

beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

async function unconfirmed(expiresAt: Date) {
  const id = newId();
  await prisma.pendingUpload.create({
    data: {
      id,
      purpose: 'PLACE_PHOTO',
      uploaderUserId: newId(),
      objectPath: `uploads/${id}/original`,
      declaredContentType: 'image/png',
      maxBytes: 10,
      expiresAt,
    },
  });
  await put(`uploads/${id}/original`);
  return id;
}

describe('PendingUploadsReapJob', () => {
  it('reaps, objects first, only what the window makes due', async () => {
    const now = new Date('2027-03-01T12:00:00Z');
    const expired = await unconfirmed(new Date(now.getTime() - 1));
    const live = await unconfirmed(new Date(now.getTime() + 60_000));
    const staleUnused = await confirmedUpload(prisma, newId(), {
      confirmedAt: new Date(now.getTime() - 15 * DAY),
    });
    const freshUnused = await confirmedUpload(prisma, newId(), {
      confirmedAt: new Date(now.getTime() - 13 * DAY),
    });
    const staleUsed = await confirmedUpload(prisma, newId(), {
      confirmedAt: new Date(now.getTime() - 15 * DAY),
      consumedAt: new Date(now.getTime() - 14 * DAY),
    });
    for (const upload of [staleUnused, staleUsed]) {
      for (const variant of Object.values(upload.variants)) await put(variant.objectPath);
    }

    expect(await reap.run(now)).toEqual({ reaped: 2, originalsSwept: 0 });
    const left = (await prisma.pendingUpload.findMany({ select: { id: true } })).map(
      (row) => row.id,
    );
    expect(left.toSorted(compareStrings)).toEqual(
      [live, freshUnused.id, staleUsed.id].toSorted(compareStrings),
    );
    expect(await exists(`uploads/${expired}/original`)).toBe(false);
    expect(await exists(`uploads/${live}/original`)).toBe(true);
    expect(await exists(staleUnused.variants.card.objectPath)).toBe(false);
    // A used upload's variants are a photo's now.
    expect(await exists(staleUsed.variants.card.objectPath)).toBe(true);
  });

  it('sweeps the original a confirm could not delete, within the last day', async () => {
    const now = new Date();
    const recent = await confirmedUpload(prisma, newId(), {
      confirmedAt: new Date(now.getTime() - 60_000),
    });
    const old = await confirmedUpload(prisma, newId(), {
      confirmedAt: new Date(now.getTime() - 2 * DAY),
    });
    await put(`uploads/${recent.id}/original`);
    await put(`uploads/${old.id}/original`);
    expect(await reap.run(now)).toEqual({ reaped: 0, originalsSwept: 1 });
    expect(await exists(`uploads/${recent.id}/original`)).toBe(false);
    expect(await exists(`uploads/${old.id}/original`)).toBe(true);
    expect(await reap.run(now)).toEqual({ reaped: 0, originalsSwept: 0 });
  });

  it('leaves a row whose objects could not be deleted, for the next run', async () => {
    const now = new Date();
    const id = await unconfirmed(new Date(now.getTime() - 1));
    const failing = withFailingDelete('storage down');
    const broken = catalogServices(prisma, { storage: failing }).reap;
    await expect(broken.run(now)).rejects.toThrow('storage down');
    expect(await prisma.pendingUpload.count({ where: { id } })).toBe(1);
    expect(await reap.run(now)).toEqual({ reaped: 1, originalsSwept: 0 });
  });
});

describe('PhotoObjectsCleanupJob', () => {
  it('deletes each listed object, then its row, up to now', async () => {
    const now = new Date();
    const paths = [`photos/${newId()}/card.webp`, `photos/${newId()}/full.webp`];
    for (const path of paths) await put(path);
    await prisma.orphanedObject.createMany({
      data: [
        ...paths.map((objectPath) => ({ objectPath, createdAt: new Date(now.getTime() - 1000) })),
        // Listed after this run's window: the next run takes it.
        { objectPath: 'photos/later/card.webp', createdAt: new Date(now.getTime() + 60_000) },
        // Already gone: deleting a missing object is not an error.
        { objectPath: 'photos/gone/card.webp', createdAt: new Date(now.getTime() - 1000) },
      ],
    });
    expect(await cleanup.run(now)).toEqual({ deleted: 3, failed: 0 });
    for (const path of paths) expect(await exists(path)).toBe(false);
    expect((await prisma.orphanedObject.findMany()).map((row) => row.objectPath)).toEqual([
      'photos/later/card.webp',
    ]);
  });

  it('keeps what it could not delete and fails the run, so job_runs shows it', async () => {
    await prisma.orphanedObject.create({ data: { objectPath: 'photos/x/card.webp' } });
    const failing = withFailingDelete('down');
    const broken = catalogServices(prisma, { storage: failing }).cleanup;
    await expect(broken.run(new Date())).rejects.toThrow('1 of 1 objects could not be deleted');
    expect(await prisma.orphanedObject.count()).toBe(1);
  });
});
