import { Global, Module } from '@nestjs/common';
import { BoostsGrpcController } from './boosts-grpc.controller';
import { BoostsService } from './boosts.service';

/** Discovery boosts (api-endpoints-plan §5.2): the owner's set and the reads. */
@Global()
@Module({
  controllers: [BoostsGrpcController],
  providers: [BoostsService],
  exports: [BoostsService],
})
export class BoostsModule {}
