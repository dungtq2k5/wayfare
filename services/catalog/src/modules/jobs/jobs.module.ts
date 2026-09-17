import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { PendingUploadsReapJob } from './pending-uploads-reap.job';
import { PhotoObjectsCleanupJob } from './photo-objects-cleanup.job';

/** catalog's scheduled jobs — the list health is judged against (conventions §7.3). */
export const SCHEDULED_JOBS = ['pending-uploads-reap', 'photo-objects-cleanup'] as const;

/** The job classes; nest-common's `JobsModule` schedules and runs them. */
@Module({
  imports: [UploadsModule],
  providers: [PendingUploadsReapJob, PhotoObjectsCleanupJob],
  exports: [PendingUploadsReapJob, PhotoObjectsCleanupJob],
})
export class JobsModule {}
