import { Module } from '@nestjs/common';
import { LocalizationSourcesGrpcController } from './localization-sources-grpc.controller';
import { LocalizationSourcesService } from './localization-sources.service';

/** `catalog.PlaceService`'s localization source, for narration (api-endpoints-plan §12.2). */
@Module({
  controllers: [LocalizationSourcesGrpcController],
  providers: [LocalizationSourcesService],
})
export class LocalizationSourcesModule {}
