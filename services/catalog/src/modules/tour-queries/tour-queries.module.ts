import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { TourQueriesGrpcController } from './tour-queries-grpc.controller';
import { TourQueriesService } from './tour-queries.service';

/** The tourist's tours and their sync (api-endpoints-plan §2.1, §2.2). */
@Module({
  imports: [SyncModule],
  controllers: [TourQueriesGrpcController],
  providers: [TourQueriesService],
})
export class TourQueriesModule {}
