import { Logger } from '@nestjs/common';
import { toErrorMessage } from '../errors/poison-message';
import type { RawSqlTx } from '../prisma/helpers';

/**
 * Records every scheduled job's runs in `job_runs` (rdm-spec §2.12, conventions §7.3). A job that
 * never runs writes nothing, so health is judged against the service's `SCHEDULED_JOBS` list.
 */
export class JobRunRecorder {
  private readonly logger = new Logger(JobRunRecorder.name);

  constructor(
    private readonly db: RawSqlTx,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Runs `fn`, recording its start, success or failure. Rethrows the job's error. */
  async track<T>(jobName: string, fn: () => Promise<T>): Promise<T> {
    const startedAt = this.now();
    await this.db.$executeRaw`
      INSERT INTO job_runs (job_name, last_started_at, consecutive_failures, updated_at)
      VALUES (${jobName}, ${startedAt}, 0, ${startedAt})
      ON CONFLICT (job_name) DO UPDATE SET last_started_at = EXCLUDED.last_started_at, updated_at = EXCLUDED.updated_at`;
    try {
      const result = await fn();
      const finishedAt = this.now();
      await this.db.$executeRaw`
        UPDATE job_runs
        SET last_succeeded_at = ${finishedAt}, consecutive_failures = 0, last_error = NULL,
            last_duration_ms = ${finishedAt.getTime() - startedAt.getTime()}, updated_at = ${finishedAt}
        WHERE job_name = ${jobName}`;
      return result;
    } catch (error) {
      const failedAt = this.now();
      // Only the message, truncated: never a payload, never a secret.
      const message = toErrorMessage(error).slice(0, 500);
      await this.db.$executeRaw`
        UPDATE job_runs
        SET last_failed_at = ${failedAt}, consecutive_failures = consecutive_failures + 1, last_error = ${message},
            last_duration_ms = ${failedAt.getTime() - startedAt.getTime()}, updated_at = ${failedAt}
        WHERE job_name = ${jobName}`;
      this.logger.error({ jobName, err: message }, 'scheduled job failed');
      throw error;
    }
  }
}
