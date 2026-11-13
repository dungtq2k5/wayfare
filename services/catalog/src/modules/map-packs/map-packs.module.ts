import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { MapPacksGrpcController } from './map-packs-grpc.controller';
import { MapPacksService } from './map-packs.service';

/** Map pack registration and publication (api-endpoints-plan §3.6, rdm-spec C-14). */
@Module({
  imports: [UploadsModule],
  controllers: [MapPacksGrpcController],
  providers: [MapPacksService],
  exports: [MapPacksService],
})
export class MapPacksModule {}
