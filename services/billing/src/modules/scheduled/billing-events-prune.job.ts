import { Injectable } from '@nestjs/common';
import { BILLING_EVENT_RETENTION_DAYS } from '@wayfare/contracts';
import type { ScheduledJob } from '@wayfare/nest-common';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rows one statement deletes; a run repeats until none is left. */
export const BILLING_EVENTS_PRUNE_BATCH = 1_000;

/** Deletes recorded events older than `BILLING_EVENT_RETENTION_DAYS` (rdm-spec B-4, §7). */
@Injectable()
export class BillingEventsPruneJob implements ScheduledJob {
  readonly name = 'billing-events-prune';
  readonly everyMs = DAY_MS;

  constructor(private readonly prisma: PrismaService) {}

  async run(now: Date = new Date()): Promise<{ deleted: number }> {
    const cutoff = new Date(now.getTime() - BILLING_EVENT_RETENTION_DAYS * DAY_MS);
    let deleted = 0;
    for (;;) {
      const batch = await this.prisma.$executeRaw`
        DELETE FROM billing_events
        WHERE id IN (SELECT id FROM billing_events WHERE received_at < ${cutoff}
                     ORDER BY received_at LIMIT ${BILLING_EVENTS_PRUNE_BATCH})`;
      deleted += batch;
      if (batch < BILLING_EVENTS_PRUNE_BATCH) return { deleted };
    }
  }
}
