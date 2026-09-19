import { Module } from '@nestjs/common';
import { BillingPortModule } from '../billing-port/billing-port.module';
import { IdentityPortModule } from '../identity-port/identity-port.module';
import { PlacesModule } from '../places/places.module';
import { SubmissionReviewGrpcController } from './submission-review-grpc.controller';
import { SubmissionReviewService } from './submission-review.service';

/** The submission review queue (api-endpoints-plan §3.4). */
@Module({
  imports: [PlacesModule, BillingPortModule, IdentityPortModule],
  controllers: [SubmissionReviewGrpcController],
  providers: [SubmissionReviewService],
})
export class SubmissionReviewModule {}
