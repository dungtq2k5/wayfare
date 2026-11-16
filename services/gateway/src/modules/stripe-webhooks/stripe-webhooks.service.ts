import { Injectable } from '@nestjs/common';
import { StripeEndpoint } from '@wayfare/contracts';
import { stripeEndpointProto } from '@wayfare/contracts/grpc';
import type { RequestContext } from '@wayfare/nest-common';
import { BillingServiceGrpcClient } from '../billing/billing-service-grpc.client';

/**
 * Forwards Stripe's events to billing, which holds the secret, verifies and records them
 * (api-endpoints-plan §6.3). The gateway never parses the body.
 */
@Injectable()
export class StripeWebhooksService {
  constructor(private readonly billing: BillingServiceGrpcClient) {}

  async forward(context: RequestContext, rawBody: Buffer, signature: string): Promise<void> {
    await this.billing.webhooks.call(
      'receiveStripeEvent',
      { rawBody, signature, endpoint: stripeEndpointProto.toProto(StripeEndpoint.PLATFORM) },
      context,
    );
  }
}
