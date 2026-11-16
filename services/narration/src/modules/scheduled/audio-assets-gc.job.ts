import { Inject, Injectable, Logger } from '@nestjs/common';
import { AUDIO_ASSET_RETENTION_DAYS } from '@wayfare/contracts';
import type { ScheduledJob } from '@wayfare/nest-common';
import { STORAGE_PROVIDER } from '@wayfare/nest-common/storage';
import type { StorageProvider } from '@wayfare/nest-common/storage';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Assets one run handles; the next run takes the rest. */
export const AUDIO_GC_BATCH_SIZE = 500;

/**
 * Deletes audio no event has named for `AUDIO_ASSET_RETENTION_DAYS` (rdm-spec N-3): the object
 * first, the row second, so a failure is retried on the next run.
 */
@Injectable()
export class AudioAssetsGcJob implements ScheduledJob {
  readonly name = 'audio-assets-gc';
  readonly everyMs = DAY_MS;
  private readonly logger = new Logger(AudioAssetsGcJob.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async run(now: Date = new Date()): Promise<{ deleted: number; failed: number }> {
    const due = await this.prisma.audioAsset.findMany({
      where: {
        lastReferencedAt: { lt: new Date(now.getTime() - AUDIO_ASSET_RETENTION_DAYS * DAY_MS) },
      },
      orderBy: [{ lastReferencedAt: 'asc' }, { id: 'asc' }],
      take: AUDIO_GC_BATCH_SIZE,
      select: { id: true, objectPath: true },
    });
    let deleted = 0;
    let failed = 0;
    for (const asset of due) {
      try {
        await this.storage.delete(asset.objectPath);
        await this.prisma.audioAsset.delete({ where: { id: asset.id }, select: { id: true } });
        deleted++;
      } catch (error) {
        failed++;
        this.logger.warn(
          { assetId: asset.id, err: error instanceof Error ? error.message : 'unknown' },
          'could not delete an audio asset',
        );
      }
    }
    // Recorded as a failed run, so a stuck object shows in job_runs.
    if (failed > 0) throw new Error(`${failed} of ${due.length} audio assets could not be deleted`);
    return { deleted, failed };
  }
}
