import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { Env } from '../../config/env.schema';

/** Stripe's signature tolerance, in seconds (api-endpoints-plan §6.3). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** A signature that does not verify. Never carries the body. */
export class WebhookSignatureError extends Error {
  constructor() {
    super('webhook signature did not verify');
    this.name = 'WebhookSignatureError';
  }
}

/** A verified event's parts billing reads before processing. */
export interface VerifiedStripeEvent {
  readonly id: string;
  readonly type: string;
  /** Stripe's `created`, seconds. */
  readonly created: number;
  readonly livemode: boolean;
  /** The whole event, as it will be stored. */
  readonly raw: Record<string, unknown>;
}

/**
 * Verifies a Stripe webhook over its exact bytes with the real SDK and the webhook secret — no API
 * key is needed, and it is never faked, so a bad-signature test tests Stripe's own check.
 */
@Injectable()
export class StripeWebhookVerifier {
  private readonly secret: string;

  constructor(config: ConfigService<Env, true>) {
    this.secret = config.get('STRIPE_WEBHOOK_SECRET', { infer: true });
  }

  verify(rawBody: Buffer, signature: string): VerifiedStripeEvent {
    let event: Stripe.Event;
    try {
      event = Stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.secret,
        WEBHOOK_TOLERANCE_SECONDS,
      );
    } catch {
      throw new WebhookSignatureError();
    }
    return {
      id: event.id,
      type: event.type,
      created: event.created,
      livemode: event.livemode,
      raw: JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>,
    };
  }
}
