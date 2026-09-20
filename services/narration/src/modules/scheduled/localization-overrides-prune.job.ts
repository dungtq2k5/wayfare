import { Injectable } from '@nestjs/common';
import { LOCALIZATION_OVERRIDE_RETENTION_DAYS, OverrideStatus } from '@wayfare/contracts';
import type { ScheduledJob } from '@wayfare/nest-common';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes retired corrections older than `LOCALIZATION_OVERRIDE_RETENTION_DAYS` (rdm-spec N-7) —
 * kept that long as a starting point for re-correcting. `ACTIVE` rows are never pruned: one whose
 * source has moved on is retired by the task that meets it, so everything here is out of use.
 */
@Injectable()
export class LocalizationOverridesPruneJob implements ScheduledJob {
  readonly name = 'localization-overrides-prune';
  readonly everyMs = DAY_MS;

  constructor(private readonly prisma: PrismaService) {}

  async run(now: Date = new Date()): Promise<{ deleted: number }> {
    const { count } = await this.prisma.localizationOverride.deleteMany({
      where: {
        status: OverrideStatus.REVERTED,
        updatedAt: { lt: new Date(now.getTime() - LOCALIZATION_OVERRIDE_RETENTION_DAYS * DAY_MS) },
      },
    });
    return { deleted: count };
  }
}
