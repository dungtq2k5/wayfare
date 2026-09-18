import type { SynthesisJobStatus } from '@wayfare/contracts';
import { LIVE_JOB_STATUSES } from './job-status';

/** An existing job for the same target, as supersede reads it. */
export interface ExistingJob {
  readonly id: string;
  readonly status: SynthesisJobStatus;
  readonly sourceContentHash: string;
}

/**
 * The jobs a new one supersedes (rdm-spec N-1): every live job for the same target made from a
 * different source text. A job for the same text is left alone — its tasks are what the new job's
 * tasks coalesce into.
 */
export function jobsToSupersede(
  existing: readonly ExistingJob[],
  sourceContentHash: string,
): string[] {
  return existing
    .filter(
      (job) =>
        LIVE_JOB_STATUSES.includes(job.status) && job.sourceContentHash !== sourceContentHash,
    )
    .map((job) => job.id);
}
