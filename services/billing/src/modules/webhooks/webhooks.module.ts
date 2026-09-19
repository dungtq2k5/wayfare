import { Global, Module } from '@nestjs/common';
import { WebhooksGrpcController } from './webhooks-grpc.controller';
import { WebhooksService } from './webhooks.service';

/** Stripe's platform webhook: receipt and processing (api-endpoints-plan §6.3). */
@Global()
@Module({
  controllers: [WebhooksGrpcController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
