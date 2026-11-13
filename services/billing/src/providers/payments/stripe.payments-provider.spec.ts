import { describe, expect, it } from 'vitest';
import { StripePaymentsProvider } from './stripe.payments-provider';

describe("the Stripe adapter's Checkout", () => {
  it('turns Adaptive Pricing off, so the amount is in US dollars as the pricing page says', async () => {
    const provider = new StripePaymentsProvider('sk_test_unused');
    const sent: Record<string, unknown>[] = [];
    // The client's one call this test makes, recorded instead of sent.
    (provider as unknown as { stripe: unknown }).stripe = {
      checkout: {
        sessions: {
          create: (params: Record<string, unknown>) => {
            sent.push(params);
            return Promise.resolve({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
          },
        },
      },
    };
    await provider.createSubscriptionCheckout({
      customerId: 'cus_1',
      priceId: 'price_1',
      billingAccountId: 'acct-1',
      successUrl: 'http://console.localhost/owner/billing?checkout=success',
      cancelUrl: 'http://console.localhost/owner/billing?checkout=cancelled',
      idempotencyKey: 'session-1',
      expiresAt: new Date('2026-11-02T01:00:00Z'),
    });
    expect(sent[0]).toMatchObject({ mode: 'subscription', adaptive_pricing: { enabled: false } });
  });
});
