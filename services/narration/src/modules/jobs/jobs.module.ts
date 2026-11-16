import { Module } from '@nestjs/common';
import { JobsGrpcController } from './jobs-grpc.controller';
import { JobsService } from './jobs.service';

/** Synthesis jobs: creation, supersede and the monitor's actions (rdm-spec N-1). */
@Module({
  controllers: [JobsGrpcController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
