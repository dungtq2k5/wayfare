import { Module } from '@nestjs/common';
import { BillingPortModule } from '../billing-port/billing-port.module';
import { UploadsModule } from '../uploads/uploads.module';
import { PlacesGrpcController } from './places-grpc.controller';
import { PlacesService } from './places.service';

/** Staff administration of Places (api-endpoints-plan §3.5). */
@Module({
  imports: [UploadsModule, BillingPortModule],
  controllers: [PlacesGrpcController],
  providers: [PlacesService],
  exports: [PlacesService],
})
export class PlacesModule {}
