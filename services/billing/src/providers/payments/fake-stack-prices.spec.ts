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
});

describe('the fake failure marker', () => {
  it("is read from the object's metadata", () => {
    expect(hasFakeFailureMarker({ metadata: { wayfare_fake_failure: '1' } })).toBe(true);
    expect(hasFakeFailureMarker({ metadata: {} })).toBe(false);
    expect(hasFakeFailureMarker({})).toBe(false);
    expect(hasFakeFailureMarker(null)).toBe(false);
  });
});
