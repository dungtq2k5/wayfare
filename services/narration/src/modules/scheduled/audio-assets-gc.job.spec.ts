import { AUDIO_ASSET_RETENTION_DAYS } from '@wayfare/contracts';
import type { StorageProvider } from '@wayfare/nest-common/storage';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { AUDIO_GC_BATCH_SIZE, AudioAssetsGcJob } from './audio-assets-gc.job';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-20T00:00:00Z');

function job(assets: { id: string; objectPath: string }[], failing: string[] = []) {
  const order: string[] = [];
  const prisma = {
    audioAsset: {
      findMany: vi.fn(() => Promise.resolve(assets)),
      delete: vi.fn(({ where }: { where: { id: string } }) => {
        order.push(`row ${where.id}`);
        return Promise.resolve({ id: where.id });
      }),
    },
  };
  const storage = {
    delete: vi.fn((path: string) => {
      order.push(`object ${path}`);
      return failing.includes(path) ? Promise.reject(new Error('denied')) : Promise.resolve();
    }),
  };
  return {
    gc: new AudioAssetsGcJob(
      prisma as unknown as PrismaService,
      storage as unknown as StorageProvider,
    ),
    prisma,
    order,
  };
}

describe('audio garbage collection (rdm-spec N-3)', () => {
  it('takes the oldest assets unnamed for the retention period, a batch at a time', async () => {
    const { gc, prisma } = job([]);
    expect(await gc.run(now)).toEqual({ deleted: 0, failed: 0 });
    expect(prisma.audioAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          lastReferencedAt: { lt: new Date(now.getTime() - AUDIO_ASSET_RETENTION_DAYS * DAY_MS) },
        },
        orderBy: [{ lastReferencedAt: 'asc' }, { id: 'asc' }],
        take: AUDIO_GC_BATCH_SIZE,
      }),
    );
  });

  it('deletes the object first and its row second', async () => {
    const { gc, order } = job([{ id: 'a1', objectPath: 'audio/a1.mp3' }]);
    expect(await gc.run(now)).toEqual({ deleted: 1, failed: 0 });
    expect(order).toEqual(['object audio/a1.mp3', 'row a1']);
  });

  it('keeps the row of an object it could not delete, and fails the run so it shows', async () => {
    const { gc, order } = job(
      [
        { id: 'a1', objectPath: 'audio/a1.mp3' },
        { id: 'a2', objectPath: 'audio/a2.mp3' },
      ],
      ['audio/a1.mp3'],
    );
    await expect(gc.run(now)).rejects.toThrow('1 of 2 audio assets could not be deleted');
    expect(order).toEqual(['object audio/a1.mp3', 'object audio/a2.mp3', 'row a2']);
  });
});
