import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubmissionReviewedConsumer } from './submission-reviewed.consumer';

/** The `catalog.submission.reviewed` consumer. */
@Module({
  imports: [NotificationsModule],
  providers: [SubmissionReviewedConsumer],
  exports: [SubmissionReviewedConsumer],
})
export class SubmissionReviewedModule {}
