import { Module } from '@nestjs/common';
import { StripeWebhooksController } from './stripe-webhooks.controller';
import { StripeWebhooksService } from './stripe-webhooks.service';

/** `POST /api/webhooks/stripe`, backed by `billing.BillingWebhookService`. */
@Module({ controllers: [StripeWebhooksController], providers: [StripeWebhooksService] })
export class StripeWebhooksModule {}
