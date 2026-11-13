import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { PlaceQueriesGrpcController } from './place-queries-grpc.controller';
import { PlaceQueriesService } from './place-queries.service';

/** The tourist read path (api-endpoints-plan §2.1). */
@Module({
  imports: [SyncModule],
  controllers: [PlaceQueriesGrpcController],
  providers: [PlaceQueriesService],
  exports: [PlaceQueriesService],
})
export class PlaceQueriesModule {}
