import { describe, expect, it } from 'vitest';
import { hasFakeFailureMarker } from '../../modules/webhooks/webhooks.service';
import { stackFakePayments } from './fake-stack-prices';
import { PaymentsNotFoundError } from './payments-provider';

describe("the stack's fake Stripe", () => {
  it('answers its fixed test prices as listed, and nothing else', async () => {
    const fake = stackFakePayments();
    expect(await fake.retrievePrice('price_testGrowthMonthly2')).toMatchObject({
      unitAmount: 1200,
      currency: 'usd',
      recurringInterval: 'month',
      productId: 'prod_dev_growth',
    });
    expect((await fake.retrievePrice('price_testEur')).currency).toBe('eur');
    expect((await fake.retrievePrice('price_testInactive')).active).toBe(false);
    expect((await fake.retrievePrice('price_testOtherProduct')).productId).toBe('prod_test_other');
    expect((await fake.retrievePrice('price_dev_growth_month')).unitAmount).toBe(900);
    await expect(fake.retrievePrice('price_nobody')).rejects.toBeInstanceOf(PaymentsNotFoundError);
  });

  it("opens the console's fake Checkout and portal pages, and finds a Checkout by its session", async () => {
    const fake = stackFakePayments('http://console.localhost');
    const checkout = {
      billingAccountId: 'acct-1',
      customerId: 'cus_1',
      priceId: 'price_dev_growth_month',
      successUrl: 'http://console.localhost/owner/billing?checkout=success',
      cancelUrl: 'http://console.localhost/owner/billing/plans',
      idempotencyKey: 'session-1',
      expiresAt: new Date('2026-11-01T01:00:00Z'),
    };
    expect(await fake.createSubscriptionCheckout(checkout)).toEqual({
      url: 'http://console.localhost/dev/fake-stripe/checkout/session-1',
    });
    expect(fake.checkoutSession('session-1')).toEqual(checkout);
    expect(fake.checkoutSession('session-2')).toBeUndefined();
    expect(
      await fake.createPortalSession({
        customerId: 'cus_1',
        returnUrl: 'http://console.localhost/owner/billing',
      }),
    ).toEqual({
      url: 'http://console.localhost/dev/fake-stripe/portal?return=http%3A%2F%2Fconsole.localhost%2Fowner%2Fbilling',
    });
  });
});

describe('the fake failure marker', () => {
  it("is read from the object's metadata", () => {
    expect(hasFakeFailureMarker({ metadata: { wayfare_fake_failure: '1' } })).toBe(true);
    expect(hasFakeFailureMarker({ metadata: {} })).toBe(false);
    expect(hasFakeFailureMarker({})).toBe(false);
    expect(hasFakeFailureMarker(null)).toBe(false);
  });
});
