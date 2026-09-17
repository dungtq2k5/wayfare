import { Global, Module } from '@nestjs/common';
import { DevicesGrpcController } from './devices-grpc.controller';
import { DevicesService } from './devices.service';

/** Anonymous installs — the primary identity (ADR 0003). Exports the claim and liveness checks. */
@Global()
@Module({
  controllers: [DevicesGrpcController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
