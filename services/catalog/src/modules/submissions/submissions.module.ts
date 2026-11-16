import { Module } from '@nestjs/common';
import { BillingPortModule } from '../billing-port/billing-port.module';
import { PlacesModule } from '../places/places.module';
import { SubmissionsGrpcController } from './submissions-grpc.controller';
import { SubmissionsService } from './submissions.service';

/** An owner's own submissions (api-endpoints-plan §3.3). */
@Module({
  imports: [PlacesModule, BillingPortModule],
  controllers: [SubmissionsGrpcController],
  providers: [SubmissionsService],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
