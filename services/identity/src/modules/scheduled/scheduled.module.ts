import { Module } from '@nestjs/common';
import { AccountRecoveriesAdvanceJob } from './account-recoveries-advance.job';
import { NotificationsPruneJob } from './notifications-prune.job';
import { OwnerPiiRedactJob } from './owner-pii-redact.job';

/** identity's scheduled jobs — the list health is judged against (conventions §7.3). */
export const SCHEDULED_JOBS = [
  'notifications-prune',
  'owner-pii-redact',
  'account-recoveries-advance',
] as const;

/** The job classes; nest-common's `JobsModule` schedules and runs them. */
@Module({
  providers: [NotificationsPruneJob, OwnerPiiRedactJob, AccountRecoveriesAdvanceJob],
  exports: [NotificationsPruneJob, OwnerPiiRedactJob, AccountRecoveriesAdvanceJob],
})
export class ScheduledModule {}
