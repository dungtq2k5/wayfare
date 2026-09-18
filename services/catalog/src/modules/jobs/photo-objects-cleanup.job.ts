import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ScheduledJob } from '@wayfare/nest-common';
import { STORAGE_PROVIDER } from '@wayfare/nest-common/storage';
import type { StorageProvider } from '@wayfare/nest-common/storage';
import { PrismaService } from '../prisma/prisma.service';

/** Paths one run handles; the next run takes the rest. */
export const CLEANUP_BATCH_SIZE = 500;

/** What one run did. */
export interface CleanupResult {
  readonly deleted: number;
  readonly failed: number;
}

/**
 * Deletes the objects of removed photos (rdm-spec C-5, C-17): each listed path's object, then its
 * row, so a failure is retried on the next run. Only paths listed before `now` are taken.
 */
@Injectable()
export class PhotoObjectsCleanupJob implements ScheduledJob {
  readonly name = 'photo-objects-cleanup';
  readonly everyMs = 15 * 60 * 1000;
  private readonly logger = new Logger(PhotoObjectsCleanupJob.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async run(now: Date = new Date()): Promise<CleanupResult> {
    const due = await this.prisma.orphanedObject.findMany({
      where: { createdAt: { lte: now } },
      select: { objectPath: true },
      orderBy: [{ createdAt: 'asc' }, { objectPath: 'asc' }],
      take: CLEANUP_BATCH_SIZE,
    });
    let deleted = 0;
    let failed = 0;
    for (const { objectPath } of due) {
      try {
        await this.storage.delete(objectPath);
        await this.prisma.orphanedObject.delete({
          where: { objectPath },
          select: { objectPath: true },
        });
        deleted++;
      } catch (error) {
        failed++;
        this.logger.warn(
          { objectPath, err: error instanceof Error ? error.message : 'unknown' },
          'could not delete a removed photo object',
        );
      }
    }
    // Recorded as a failed run, so a stuck object shows in job_runs.
    if (failed > 0) throw new Error(`${failed} of ${due.length} objects could not be deleted`);
    return { deleted, failed };
  }
}
