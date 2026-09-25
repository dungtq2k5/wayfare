import { Inject, Injectable } from '@nestjs/common';
import {
  LocalizationTargetType,
  SOCKET_ROOMS,
  SynthesisJobStatus,
  SynthesisStage,
  SynthesisTaskStatus,
} from '@wayfare/contracts';
import type { Language } from '@wayfare/contracts';
import { SocketEmitter } from '@wayfare/nest-common';

/** Injection token for narration's socket emitter. */
export const SOCKET_EMITTER = Symbol('SOCKET_EMITTER');

/** A job, as its status frame reports it. */
export interface JobFrameRow {
  readonly id: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly status: string;
  readonly completedTasks: number;
  readonly failedTasks: number;
  readonly totalTasks: number;
}

/** A task, as its progress frame reports it. */
export interface TaskFrameRow {
  readonly jobId: string;
  readonly lang: string;
  readonly stage: string;
  readonly status: string;
}

/**
 * The monitor's live frames (api-endpoints-plan §9): a job's status to the admin room and its own
 * room, a task's stage to the job's room only. Fire-and-forget — the tables are the record.
 */
@Injectable()
export class ProgressService {
  constructor(@Inject(SOCKET_EMITTER) private readonly emitter: Pick<SocketEmitter, 'toRoom'>) {}

  jobStatus(job: JobFrameRow): void {
    // Non-null: `target_id` is NULL only for a `UI_BUNDLE` job, and bundle translation runs on its
    // own queue, never as a synthesis job, so every row this reads has a target.
    this.emitter.toRoom(
      [SOCKET_ROOMS.adminNarration, SOCKET_ROOMS.job(job.id)],
      'narrationJobStatus',
      {
        jobId: job.id,
        targetType: job.targetType as LocalizationTargetType,
        targetId: job.targetId!,
        status: job.status as SynthesisJobStatus,
        completedTasks: job.completedTasks,
        failedTasks: job.failedTasks,
        totalTasks: job.totalTasks,
      },
    );
  }

  taskProgress(task: TaskFrameRow): void {
    this.emitter.toRoom(SOCKET_ROOMS.job(task.jobId), 'narrationTaskProgress', {
      jobId: task.jobId,
      lang: task.lang as Language,
      stage: task.stage as SynthesisStage,
      status: task.status as SynthesisTaskStatus,
    });
  }
}
