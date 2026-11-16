import { Module } from '@nestjs/common';
import { BillingPortModule } from '../billing-port/billing-port.module';
import { OwnerEntitlementsModule } from '../owner-entitlements/owner-entitlements.module';
import { UploadsModule } from '../uploads/uploads.module';
import { PlacesGrpcController } from './places-grpc.controller';
import { PlacesService } from './places.service';

/** Staff administration of Places (api-endpoints-plan §3.5). */
@Module({
  imports: [UploadsModule, BillingPortModule, OwnerEntitlementsModule],
  controllers: [PlacesGrpcController],
  providers: [PlacesService],
  exports: [PlacesService],
})
export class PlacesModule {}
