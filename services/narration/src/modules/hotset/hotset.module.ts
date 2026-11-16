import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { JobsModule } from '../jobs/jobs.module';
import { HotsetGrpcController } from './hotset-grpc.controller';
import { HotsetService } from './hotset.service';

/** The language switch's warmup and the walk-ahead prefetch (api-endpoints-plan §4.1). */
@Module({
  imports: [CatalogModule, JobsModule],
  controllers: [HotsetGrpcController],
  providers: [HotsetService],
  exports: [HotsetService],
})
export class HotsetModule {}
