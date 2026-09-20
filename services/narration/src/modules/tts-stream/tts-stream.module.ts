import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { CatalogModule } from '../catalog/catalog.module';
import { TtsStreamGrpcController } from './tts-stream-grpc.controller';
import { TtsStreamService } from './tts-stream.service';

/** Audio tier 2: the live stream (api-endpoints-plan §4.1). */
@Module({
  imports: [CatalogModule, BillingModule],
  controllers: [TtsStreamGrpcController],
  providers: [TtsStreamService],
  exports: [TtsStreamService],
})
export class TtsStreamModule {}
