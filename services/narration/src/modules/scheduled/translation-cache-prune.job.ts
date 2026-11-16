import { Injectable } from '@nestjs/common';
import { TRANSLATION_CACHE_RETENTION_DAYS } from '@wayfare/contracts';
import type { ScheduledJob } from '@wayfare/nest-common';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Deletes translations unused for `TRANSLATION_CACHE_RETENTION_DAYS` (rdm-spec N-4). */
@Injectable()
export class TranslationCachePruneJob implements ScheduledJob {
  readonly name = 'translation-cache-prune';
  readonly everyMs = DAY_MS;

  constructor(private readonly prisma: PrismaService) {}

  async run(now: Date = new Date()): Promise<{ deleted: number }> {
    const { count } = await this.prisma.translationCache.deleteMany({
      where: {
        lastUsedAt: { lt: new Date(now.getTime() - TRANSLATION_CACHE_RETENTION_DAYS * DAY_MS) },
      },
    });
    return { deleted: count };
  }
}
