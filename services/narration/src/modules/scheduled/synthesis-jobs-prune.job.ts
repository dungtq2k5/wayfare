import { Injectable } from '@nestjs/common';
import { JOB_RETENTION_DAYS } from '@wayfare/contracts';
import type { ScheduledJob } from '@wayfare/nest-common';
import { TERMINAL_JOB_STATUSES } from '../jobs/domain/job-status';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Deletes finished jobs after `JOB_RETENTION_DAYS`; their tasks go with them (rdm-spec §7). */
@Injectable()
export class SynthesisJobsPruneJob implements ScheduledJob {
  readonly name = 'synthesis-jobs-prune';
  readonly everyMs = DAY_MS;

  constructor(private readonly prisma: PrismaService) {}

  async run(now: Date = new Date()): Promise<{ deleted: number }> {
    const { count } = await this.prisma.synthesisJob.deleteMany({
      where: {
        status: { in: [...TERMINAL_JOB_STATUSES] },
        finishedAt: { lt: new Date(now.getTime() - JOB_RETENTION_DAYS * DAY_MS) },
      },
    });
    return { deleted: count };
  }
}
