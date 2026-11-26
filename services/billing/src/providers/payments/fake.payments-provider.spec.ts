import { describe, expect, it, vi } from 'vitest';
import { FakeCheckoutService } from '../../modules/fake-checkout/fake-checkout.service';
import { FakePaymentsProvider } from './fake.payments-provider';
import { PaymentsUnavailableError } from './payments-provider';

const SESSION = '01990000-0000-7000-8000-000000000001';
const checkout = {
  customerId: 'cus_1',
  priceId: 'price_1',
  billingAccountId: 'acct',
  successUrl: 's',
  cancelUrl: 'c',
  idempotencyKey: SESSION,
  expiresAt: new Date(),
};

describe('the fake payments provider', () => {
  it('opens the console’s fake portal on a stack, back to the page asked', async () => {
    const fake = new FakePaymentsProvider('http://console.localhost');
    expect(
      await fake.createPortalSession({ customerId: 'cus_1', returnUrl: '/owner/billing' }),
    ).toEqual({
      url: 'http://console.localhost/dev/fake-stripe/portal?return=%2Fowner%2Fbilling',
    });
  });

  it('has no invoices for a customer none were put for, and answers an unknown subscription as Stripe down', async () => {
    const fake = new FakePaymentsProvider();
    expect(await fake.listInvoices('cus_none')).toEqual([]);
    await expect(fake.retrieveSubscription('sub_none')).rejects.toEqual(
      new PaymentsUnavailableError('PROVIDER'),
    );
  });
});

describe('paying a fake Checkout', () => {
  const service = (env: string, payments: unknown, price: unknown = null) => {
    const prisma = { planPrice: { findUnique: vi.fn(() => Promise.resolve(price)) } };
    return new FakeCheckoutService(
      prisma as never,
      payments as never,
      {} as never,
      { get: () => env } as never,
    );
  };
  const notFound = { message: expect.stringContaining('RESOURCE_NOT_FOUND') };

  it('doesn’t exist in production, nor with the real provider', async () => {
    await expect(
      service('production', new FakePaymentsProvider()).pay({ sessionId: SESSION }),
    ).rejects.toMatchObject(notFound);
    await expect(service('development', {}).pay({ sessionId: SESSION })).rejects.toMatchObject(
      notFound,
    );
  });

  it('finds no Checkout the fake didn’t open, nor one whose price billing doesn’t hold', async () => {
    const fake = new FakePaymentsProvider();
    await expect(service('development', fake).pay({ sessionId: SESSION })).rejects.toMatchObject(
      notFound,
    );
    await fake.createSubscriptionCheckout(checkout);
    await expect(service('development', fake).pay({ sessionId: SESSION })).rejects.toMatchObject(
      notFound,
    );
  });
});
