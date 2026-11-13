import { Injectable } from '@nestjs/common';
import type { ScheduledJob } from '@wayfare/nest-common';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rows one statement deletes; a run repeats until none is left. */
export const NOTIFICATIONS_PRUNE_BATCH = 1_000;

/** Deletes notifications past `expires_at` (rdm-spec I-10, §7: 90 days). */
@Injectable()
export class NotificationsPruneJob implements ScheduledJob {
  readonly name = 'notifications-prune';
  readonly everyMs = DAY_MS;

  constructor(private readonly prisma: PrismaService) {}

  async run(now: Date = new Date()): Promise<{ deleted: number }> {
    let deleted = 0;
    for (;;) {
      const batch = await this.prisma.$executeRaw`
        DELETE FROM notifications
        WHERE id IN (SELECT id FROM notifications WHERE expires_at <= ${now}
                     ORDER BY expires_at LIMIT ${NOTIFICATIONS_PRUNE_BATCH})`;
      deleted += batch;
      if (batch < NOTIFICATIONS_PRUNE_BATCH) return { deleted };
    }
  }
}
