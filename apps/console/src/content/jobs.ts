import type { JobTone } from '@wayfare/ui/content';

/** A job's status, as the API names it. */
export type JobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'PARTIALLY_FAILED'
  | 'FAILED'
  | 'CANCELLED'
  | 'SUPERSEDED';

const JOB_TONES: Record<JobStatus, JobTone> = {
  QUEUED: 'queued',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'done',
  PARTIALLY_FAILED: 'partial',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  SUPERSEDED: 'superseded',
};

export const jobTone = (status: string): JobTone => JOB_TONES[status as JobStatus] ?? 'queued';

/** A job that has finished one way or another: no control applies any more. */
export const isFinished = (status: string): boolean =>
  ['COMPLETED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED', 'SUPERSEDED'].includes(status);

/** The controls a job's state allows (J3): each shown only when it applies. */
export function controlsFor(
  status: string,
  failedTasks: number,
): ('pause' | 'resume' | 'retry' | 'cancel')[] {
  const controls: ('pause' | 'resume' | 'retry' | 'cancel')[] = [];
  if (status === 'QUEUED' || status === 'RUNNING') controls.push('pause');
  if (status === 'PAUSED') controls.push('resume');
  if (failedTasks > 0) controls.push('retry');
  if (!isFinished(status)) controls.push('cancel');
  return controls;
}

/** A task's tone: a queued task waiting for a provider is *Waiting*, never stuck (J2). */
export function taskTone(status: string, waitingForProvider: boolean): JobTone {
  if (status === 'QUEUED') return waitingForProvider ? 'waiting' : 'queued';
  if (status === 'SUCCEEDED') return 'done';
  if (status === 'COALESCED') return 'superseded';
  return jobTone(status);
}
