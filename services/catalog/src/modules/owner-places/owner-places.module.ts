import { Module } from '@nestjs/common';
import { BillingPortModule } from '../billing-port/billing-port.module';
import { PlacesModule } from '../places/places.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { OwnerPlacesGrpcController } from './owner-places-grpc.controller';
import { OwnerPlacesService } from './owner-places.service';

/** A verified owner's own Venues (api-endpoints-plan §3.1). */
@Module({
  imports: [PlacesModule, SubmissionsModule, BillingPortModule],
  controllers: [OwnerPlacesGrpcController],
  providers: [OwnerPlacesService],
})
export class OwnerPlacesModule {}
