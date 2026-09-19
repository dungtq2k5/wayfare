import { Controller } from '@nestjs/common';
import { billingGrpc } from '@wayfare/contracts/grpc';
import { WebhooksService } from './webhooks.service';

/** `wayfare.billing.BillingWebhookService` — the gateway forwards Stripe's bytes untouched. */
@Controller()
@billingGrpc.BillingWebhookServiceControllerMethods()
export class WebhooksGrpcController implements billingGrpc.BillingWebhookServiceController {
  constructor(private readonly webhooks: WebhooksService) {}

  receiveStripeEvent(
    request: billingGrpc.ReceiveStripeEventRequest,
  ): Promise<billingGrpc.ReceiveStripeEventResponse> {
    return this.webhooks.receiveStripeEvent(request);
  }
}
