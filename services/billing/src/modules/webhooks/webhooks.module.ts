import { Global, Module } from '@nestjs/common';
import { FakeCheckoutModule } from '../fake-checkout/fake-checkout.module';
import { WebhooksGrpcController } from './webhooks-grpc.controller';
import { WebhooksService } from './webhooks.service';

/** Stripe's platform webhook: receipt and processing (api-endpoints-plan §6.3), and the fake Checkout's payment on a stack. */
@Global()
@Module({
  imports: [FakeCheckoutModule],
  controllers: [WebhooksGrpcController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
