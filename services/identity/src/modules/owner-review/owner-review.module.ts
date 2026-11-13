import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OwnerReviewGrpcController } from './owner-review-grpc.controller';
import { OwnerReviewService } from './owner-review.service';

/** The owner application review queue (api-endpoints-plan §1.5, rdm-spec I-8). */
@Module({
  imports: [NotificationsModule],
  controllers: [OwnerReviewGrpcController],
  providers: [OwnerReviewService],
})
export class OwnerReviewModule {}
