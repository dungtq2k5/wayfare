import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BillingConfig } from '../../config/env.schema';
import { PaymentsProvider } from '../../providers/payments/payments-provider';
import { StripePaymentsProvider } from '../../providers/payments/stripe.payments-provider';
import { StripeWebhookVerifier } from '../../providers/payments/stripe-webhook.verifier';

/**
 * Stripe (architecture §5): the API adapter, unconfigured without a key, and the webhook verifier.
 * Tests replace `PaymentsProvider` with the fake; the verifier is always the real SDK.
 */
@Global()
@Module({
  providers: [
    {
      provide: PaymentsProvider,
      inject: [ConfigService],
      useFactory: (config: BillingConfig) =>
        new StripePaymentsProvider(config.get('STRIPE_SECRET_KEY', { infer: true })),
    },
    StripeWebhookVerifier,
  ],
  exports: [PaymentsProvider, StripeWebhookVerifier],
})
export class PaymentsModule {}
