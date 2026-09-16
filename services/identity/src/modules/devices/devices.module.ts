import { Module } from '@nestjs/common';
import { DevicesGrpcController } from './devices-grpc.controller';
import { DevicesService } from './devices.service';

/** Anonymous installs — the primary identity (ADR 0003). */
@Module({
  controllers: [DevicesGrpcController],
  providers: [DevicesService],
})
export class DevicesModule {}
