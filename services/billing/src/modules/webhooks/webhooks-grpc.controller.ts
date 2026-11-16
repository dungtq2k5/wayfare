import { Controller } from '@nestjs/common';
import { billingGrpc } from '@wayfare/contracts/grpc';
import { FakeCheckoutService } from '../fake-checkout/fake-checkout.service';
import { WebhooksService } from './webhooks.service';

/** `wayfare.billing.BillingWebhookService` — the gateway forwards Stripe's bytes untouched. */
@Controller()
@billingGrpc.BillingWebhookServiceControllerMethods()
export class WebhooksGrpcController implements billingGrpc.BillingWebhookServiceController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly fakeCheckout: FakeCheckoutService,
  ) {}

  receiveStripeEvent(
    request: billingGrpc.ReceiveStripeEventRequest,
  ): Promise<billingGrpc.ReceiveStripeEventResponse> {
    return this.webhooks.receiveStripeEvent(request);
  }

  payFakeCheckout(
    request: billingGrpc.PayFakeCheckoutRequest,
  ): Promise<billingGrpc.PayFakeCheckoutResponse> {
    return this.fakeCheckout.pay(request);
  }
}
