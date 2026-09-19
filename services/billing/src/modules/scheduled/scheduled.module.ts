import { Module } from '@nestjs/common';
import { BillingEventsPruneJob } from './billing-events-prune.job';
import { BillingWebhooksRecoverJob } from './billing-webhooks-recover.job';

/** billing's scheduled jobs — the list health is judged against (conventions §7.3). */
export const SCHEDULED_JOBS = ['billing-webhooks-recover', 'billing-events-prune'] as const;

/** The job classes; nest-common's `JobsModule` schedules and runs them. */
@Module({
  providers: [BillingWebhooksRecoverJob, BillingEventsPruneJob],
  exports: [BillingWebhooksRecoverJob, BillingEventsPruneJob],
})
export class ScheduledModule {}
