import { Global, Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { ToursGrpcController } from './tours-grpc.controller';
import { ToursService } from './tours.service';

/** Staff administration of tours (api-endpoints-plan §3.6). */
@Global()
@Module({
  imports: [UploadsModule],
  controllers: [ToursGrpcController],
  providers: [ToursService],
  exports: [ToursService],
})
export class ToursModule {}
