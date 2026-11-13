import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { NarrationGrpcController } from './narration-grpc.controller';
import { NarrationService } from './narration.service';

/** The tourist narration routes (api-endpoints-plan §4.1). */
@Module({
  imports: [JobsModule],
  controllers: [NarrationGrpcController],
  providers: [NarrationService],
})
export class NarrationModule {}
