import { SynthesisJobStatus, SynthesisTaskStatus } from '@wayfare/contracts';

/** A job's statuses that no task change moves it out of (rdm-spec N-1). */
export const TERMINAL_JOB_STATUSES: readonly SynthesisJobStatus[] = [
  SynthesisJobStatus.COMPLETED,
  SynthesisJobStatus.PARTIALLY_FAILED,
  SynthesisJobStatus.FAILED,
  SynthesisJobStatus.CANCELLED,
  SynthesisJobStatus.SUPERSEDED,
];

/** A job's statuses while it has work left. */
export const LIVE_JOB_STATUSES: readonly SynthesisJobStatus[] = [
  SynthesisJobStatus.QUEUED,
  SynthesisJobStatus.RUNNING,
  SynthesisJobStatus.PAUSED,
];

/** A task's statuses while it holds the key's one active slot (rdm-spec N-2). */
export const ACTIVE_TASK_STATUSES: readonly SynthesisTaskStatus[] = [
  SynthesisTaskStatus.QUEUED,
  SynthesisTaskStatus.RUNNING,
];

/** How many of a job's tasks are in each status. */
export type TaskCounts = Readonly<Partial<Record<SynthesisTaskStatus, number>>>;

/** Whether a status is terminal. */
export function isTerminalJobStatus(status: SynthesisJobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

/**
 * A job's status from its tasks (rdm-spec N-1). A terminal status stays. While work is left, a
 * paused job stays paused, and a job with a task running or waiting on another job's task is
 * `RUNNING`. Once nothing is left: all succeeded → `COMPLETED`, all failed → `FAILED`, some of each
 * → `PARTIALLY_FAILED`; a coalesced task has already ended as the task it followed. A job whose
 * every task was cancelled is `CANCELLED`.
 */
export function jobStatusFrom(current: SynthesisJobStatus, counts: TaskCounts): SynthesisJobStatus {
  if (isTerminalJobStatus(current)) return current;
  const count = (status: SynthesisTaskStatus) => counts[status] ?? 0;
  const running = count(SynthesisTaskStatus.RUNNING);
  const following = count(SynthesisTaskStatus.COALESCED);
  const left = count(SynthesisTaskStatus.QUEUED) + running + following;
  if (left > 0) {
    if (current === SynthesisJobStatus.PAUSED) return current;
    return running > 0 || following > 0 || current === SynthesisJobStatus.RUNNING
      ? SynthesisJobStatus.RUNNING
      : SynthesisJobStatus.QUEUED;
  }
  const succeeded = count(SynthesisTaskStatus.SUCCEEDED);
  const failed = count(SynthesisTaskStatus.FAILED);
  if (succeeded + failed === 0) return SynthesisJobStatus.CANCELLED;
  if (failed === 0) return SynthesisJobStatus.COMPLETED;
  if (succeeded === 0) return SynthesisJobStatus.FAILED;
  return SynthesisJobStatus.PARTIALLY_FAILED;
}
