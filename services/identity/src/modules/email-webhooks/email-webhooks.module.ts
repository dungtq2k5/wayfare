import { Module } from '@nestjs/common';
import { EmailWebhooksGrpcController } from './email-webhooks-grpc.controller';
import { EmailWebhooksService } from './email-webhooks.service';

/** Resend's delivery webhook (api-endpoints-plan §1.9). */
@Module({
  controllers: [EmailWebhooksGrpcController],
  providers: [EmailWebhooksService],
})
export class EmailWebhooksModule {}
