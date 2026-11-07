import { Injectable } from '@nestjs/common';
import { CONSENT_RETENTION_DAYS, RAW_EVENT_RETENTION_DAYS } from '@wayfare/contracts';
import type { ScheduledJob } from '@wayfare/nest-common';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rows one statement deletes; a run repeats until none is left. */
export const RAW_PRUNE_BATCH = 5_000;

/**
 * Deletes raw events older than `RAW_EVENT_RETENTION_DAYS` (90), and an id's consent history
 * `CONSENT_RETENTION_DAYS` (400) after its newest decision (rdm-spec A-1, A-2, §7).
 */
@Injectable()
export class RawPruneJob implements ScheduledJob {
  readonly name = 'raw-prune';
  readonly everyMs = DAY_MS;
  readonly cron = '0 4 * * *';

  constructor(private readonly prisma: PrismaService) {}

  async run(now: Date = new Date()): Promise<{ events: number; consents: number }> {
    const eventsBefore = new Date(now.getTime() - RAW_EVENT_RETENTION_DAYS * DAY_MS);
    let events = 0;
    for (;;) {
      const batch = await this.prisma.$executeRaw`
        DELETE FROM events
        WHERE id IN (SELECT id FROM events WHERE occurred_at < ${eventsBefore} LIMIT ${RAW_PRUNE_BATCH})`;
      events += batch;
      if (batch < RAW_PRUNE_BATCH) break;
    }
    const consentsBefore = new Date(now.getTime() - CONSENT_RETENTION_DAYS * DAY_MS);
    const consents = await this.prisma.$executeRaw`
      DELETE FROM consents
      WHERE analytics_device_id IN (
        SELECT analytics_device_id FROM consents
        GROUP BY analytics_device_id HAVING max(recorded_at) < ${consentsBefore})`;
    return { events, consents };
  }
}
