import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BillingConfig } from '../../config/env.schema';
import { stackFakePayments } from '../../providers/payments/fake-stack-prices';
import { PaymentsProvider } from '../../providers/payments/payments-provider';
import { StripePaymentsProvider } from '../../providers/payments/stripe.payments-provider';
import { StripeWebhookVerifier } from '../../providers/payments/stripe-webhook.verifier';

/**
 * Stripe (architecture §5): the API adapter, unconfigured without a key, and the webhook verifier.
 * `PAYMENTS_PROVIDER=fake` (the local and CI stacks) puts the in-memory fake with its fixed test
 * prices in its place; tests replace it with their own; the verifier is always the real SDK.
 */
@Global()
@Module({
  providers: [
    {
      provide: PaymentsProvider,
      inject: [ConfigService],
      useFactory: (config: BillingConfig) =>
        config.get('PAYMENTS_PROVIDER', { infer: true }) === 'fake'
          ? stackFakePayments(config.get('CONSOLE_URL', { infer: true }))
          : new StripePaymentsProvider(config.get('STRIPE_SECRET_KEY', { infer: true })),
    },
    StripeWebhookVerifier,
  ],
  exports: [PaymentsProvider, StripeWebhookVerifier],
})
export class PaymentsModule {}
