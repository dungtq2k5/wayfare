import { Module } from '@nestjs/common';
import { NotificationsPruneJob } from './notifications-prune.job';

/** identity's scheduled jobs — the list health is judged against (conventions §7.3). */
export const SCHEDULED_JOBS = ['notifications-prune'] as const;

/** The job classes; nest-common's `JobsModule` schedules and runs them. */
@Module({
  providers: [NotificationsPruneJob],
  exports: [NotificationsPruneJob],
})
export class ScheduledModule {}
