import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { JobsModule } from '../jobs/jobs.module';
import { CorrectionsGrpcController } from './corrections-grpc.controller';
import { CorrectionsService } from './corrections.service';

/** Staff translation corrections (api-endpoints-plan §4.5, rdm-spec N-7). */
@Module({
  imports: [CatalogModule, JobsModule],
  controllers: [CorrectionsGrpcController],
  providers: [CorrectionsService],
  exports: [CorrectionsService],
})
export class CorrectionsModule {}
