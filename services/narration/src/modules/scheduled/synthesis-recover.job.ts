import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { JOB_STALE_AFTER_MS, SynthesisJobStatus, SynthesisTaskStatus } from '@wayfare/contracts';
import type { ScheduledJob } from '@wayfare/nest-common';
import { ACTIVE_TASK_STATUSES } from '../jobs/domain/job-status';
import { TaskQueue } from '../tasks/tasks.module';
import { TasksService } from '../tasks/tasks.service';

/** What one sweep did. */
export interface RecoverResult {
  readonly requeued: number;
  readonly readded: number;
  readonly rehomed: number;
}

const LIVE_UNPAUSED = [SynthesisJobStatus.QUEUED, SynthesisJobStatus.RUNNING];

/**
 * Finds work a crash left behind (rdm-spec N-1): tasks of a job whose heartbeat went stale are
 * re-queued and the job recounted, waiting tasks with no queue item are added again, and followers of a cancelled task
 * are made active. A paused job's tasks are left waiting. Runs at boot and every 5 minutes, under
 * an advisory lock so replicas do not sweep twice.
 */
@Injectable()
export class SynthesisRecoverJob implements ScheduledJob, OnApplicationBootstrap {
  readonly name = 'synthesis-recover';
  readonly everyMs = 5 * 60 * 1000;
  private readonly logger = new Logger(SynthesisRecoverJob.name);

  constructor(
    private readonly tasks: TasksService,
    private readonly queue: TaskQueue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // A scheduler that already exists keeps its own timing across a restart: sweep now.
    if (!this.queue.runsWorker) return;
    await this.run(new Date()).catch((error: unknown) =>
      this.logger.error(
        { err: error instanceof Error ? error.message : 'unknown' },
        'boot recovery failed',
      ),
    );
  }

  run(now: Date = new Date()): Promise<RecoverResult> {
    return this.tasks.transact(async (tx, fx) => {
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended('narration:synthesis-recover', 0)) AS locked`;
      if (lock?.locked !== true) return { requeued: 0, readded: 0, rehomed: 0 };

      const staleBefore = new Date(now.getTime() - JOB_STALE_AFTER_MS);
      const stale = await tx.synthesisJob.findMany({
        where: {
          status: SynthesisJobStatus.RUNNING,
          OR: [{ heartbeatAt: { lt: staleBefore } }, { heartbeatAt: null }],
        },
        select: { id: true },
      });
      // Recounted too: a job whose tasks all ended is closed, whatever left it RUNNING.
      for (const job of stale) fx.jobChanged(job.id);
      const running = await tx.synthesisTask.findMany({
        where: { jobId: { in: stale.map((job) => job.id) }, status: SynthesisTaskStatus.RUNNING },
        select: { id: true, jobId: true, attempts: true, job: { select: { priority: true } } },
      });
      for (const task of running) {
        // Re-queued, not failed: the crash was not the task's fault.
        await tx.synthesisTask.update({
          where: { id: task.id },
          data: { status: SynthesisTaskStatus.QUEUED },
          select: { id: true },
        });
        fx.jobChanged(task.jobId);
        fx.enqueue({ taskId: task.id, attempts: task.attempts, priority: task.job.priority });
      }

      const waiting = await tx.synthesisTask.findMany({
        where: {
          status: SynthesisTaskStatus.QUEUED,
          job: { status: { in: LIVE_UNPAUSED } },
          id: { notIn: running.map((task) => task.id) },
        },
        select: { id: true, attempts: true, job: { select: { priority: true } } },
      });
      let readded = 0;
      for (const task of waiting) {
        if (await this.queue.has(task.id, task.attempts)) continue;
        fx.enqueue({ taskId: task.id, attempts: task.attempts, priority: task.job.priority });
        readded++;
      }

      const orphans = await tx.synthesisTask.findMany({
        where: {
          status: SynthesisTaskStatus.COALESCED,
          job: { status: { in: LIVE_UNPAUSED } },
          OR: [
            { coalescedIntoTaskId: null },
            { coalescedInto: { status: { notIn: [...ACTIVE_TASK_STATUSES] } } },
          ],
        },
        select: { id: true },
      });
      for (const orphan of orphans) {
        await this.tasks.activate(tx, await this.tasks.loadActivatable(tx, orphan.id), fx);
      }
      const result = { requeued: running.length, readded, rehomed: orphans.length };
      if (result.requeued + result.readded + result.rehomed > 0)
        this.logger.log(result, 'recovered synthesis work');
      return result;
    });
  }
}
