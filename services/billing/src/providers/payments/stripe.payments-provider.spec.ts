import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { PaymentsNotFoundError, PaymentsUnavailableError } from './payments-provider';
import { StripePaymentsProvider } from './stripe.payments-provider';

/** A provider whose Stripe client is the given fake: the calls recorded instead of sent. */
function withStripe(fake: Record<string, unknown>): StripePaymentsProvider {
  const provider = new StripePaymentsProvider('sk_test_unused');
  (provider as unknown as { stripe: unknown }).stripe = fake;
  return provider;
}

const missing = () =>
  new Stripe.errors.StripeInvalidRequestError({
    type: 'invalid_request_error',
    code: 'resource_missing',
    message: 'No such object',
  });

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

describe('the Stripe adapter', () => {
  it('without a key, says it is not configured and refuses every call', async () => {
    const provider = new StripePaymentsProvider(undefined);
    expect(provider.configured).toBe(false);
    expect(new StripePaymentsProvider('sk_test_unused').configured).toBe(true);
    await expect(provider.listInvoices('cus_1')).rejects.toEqual(
      new PaymentsUnavailableError('NOT_CONFIGURED'),
    );
  });

  it('creates one customer per billing account, its ids in the metadata', async () => {
    const create = vi.fn(() => Promise.resolve({ id: 'cus_1' }));
    const provider = withStripe({ customers: { create } });
    await expect(
      provider.createCustomer({ billingAccountId: 'acct-1', ownerUserId: 'u1' }),
    ).resolves.toEqual({ customerId: 'cus_1' });
    expect(create).toHaveBeenCalledWith(
      { metadata: { ownerUserId: 'u1', billingAccountId: 'acct-1' } },
      { idempotencyKey: 'customer:acct-1' },
    );
  });

  it('answers a Checkout session with no URL as the provider unavailable', async () => {
    const provider = withStripe({
      checkout: { sessions: { create: () => Promise.resolve({ url: null }) } },
    });
    await expect(
      provider.createSubscriptionCheckout({
        customerId: 'cus_1',
        priceId: 'price_1',
        billingAccountId: 'acct-1',
        successUrl: 'https://s',
        cancelUrl: 'https://c',
        idempotencyKey: 'k',
        expiresAt: new Date(),
      }),
    ).rejects.toEqual(new PaymentsUnavailableError('PROVIDER'));
  });

  it('opens the portal for the customer, back to the given page', async () => {
    const create = vi.fn(() => Promise.resolve({ url: 'https://portal' }));
    const provider = withStripe({ billingPortal: { sessions: { create } } });
    await expect(
      provider.createPortalSession({ customerId: 'cus_1', returnUrl: 'https://back' }),
    ).resolves.toEqual({ url: 'https://portal' });
    expect(create).toHaveBeenCalledWith({ customer: 'cus_1', return_url: 'https://back' });
  });

  it('lists the last 24 invoices, a missing id, status or link read as empty, draft or none', async () => {
    const list = vi.fn(() =>
      Promise.resolve({
        data: [
          {
            id: undefined,
            number: null,
            status: null,
            total: 900,
            amount_paid: 0,
            currency: 'usd',
            created: 1,
          },
        ],
      }),
    );
    const provider = withStripe({ invoices: { list } });
    expect(await provider.listInvoices('cus_1')).toEqual([
      {
        id: '',
        number: null,
        status: 'draft',
        total: 900,
        amountPaid: 0,
        currency: 'usd',
        created: 1,
        hostedInvoiceUrl: null,
        invoicePdf: null,
      },
    ]);
    expect(list).toHaveBeenCalledWith({ customer: 'cus_1', limit: 24 });
  });

  it('reads a price, its product as an id or an object, a one-off price with no interval', async () => {
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'price_1',
        active: true,
        currency: 'usd',
        unit_amount: 900,
        recurring: { interval: 'month' },
        product: 'prod_1',
      })
      .mockResolvedValueOnce({
        id: 'price_2',
        active: false,
        currency: 'usd',
        unit_amount: null,
        recurring: null,
        product: { id: 'prod_2' },
      });
    const provider = withStripe({ prices: { retrieve } });
    expect(await provider.retrievePrice('price_1')).toEqual({
      id: 'price_1',
      active: true,
      currency: 'usd',
      unitAmount: 900,
      recurringInterval: 'month',
      productId: 'prod_1',
    });
    expect(await provider.retrievePrice('price_2')).toMatchObject({
      recurringInterval: null,
      productId: 'prod_2',
    });
  });

  it('says a price Stripe doesn’t have is not found, and any other failure is an outage', async () => {
    const retrieve = vi
      .fn()
      .mockRejectedValueOnce(missing())
      .mockRejectedValueOnce(new Error('socket hang up'));
    const provider = withStripe({ prices: { retrieve } });
    await expect(provider.retrievePrice('price_x')).rejects.toEqual(
      new PaymentsNotFoundError('PRICE'),
    );
    await expect(provider.retrievePrice('price_x')).rejects.toEqual(
      new PaymentsUnavailableError('PROVIDER'),
    );
  });

  it('hands a subscription back as Stripe sent it', async () => {
    const subscription = { id: 'sub_1', status: 'active' };
    const provider = withStripe({
      subscriptions: { retrieve: () => Promise.resolve(subscription) },
    });
    expect(await provider.retrieveSubscription('sub_1')).toBe(subscription);
  });

  it('redacts a customer: its details blanked, every payment method detached', async () => {
    const update = vi.fn(() => Promise.resolve({}));
    const detach = vi.fn(() => Promise.resolve({}));
    const provider = withStripe({
      customers: { update, listPaymentMethods: () => [{ id: 'pm_1' }, { id: 'pm_2' }] },
      paymentMethods: { detach },
    });
    await provider.redactCustomer('cus_1');
    expect(update).toHaveBeenCalledWith('cus_1', { email: '', name: '', phone: '', address: '' });
    expect(detach.mock.calls).toEqual([['pm_1'], ['pm_2']]);
  });

  it('has nothing to redact for a customer Stripe no longer has, and reports any other failure as an outage', async () => {
    const listPaymentMethods = vi.fn();
    const update = vi.fn().mockRejectedValueOnce(missing()).mockRejectedValueOnce('boom');
    const provider = withStripe({ customers: { update, listPaymentMethods } });
    await expect(provider.redactCustomer('cus_gone')).resolves.toBeUndefined();
    expect(listPaymentMethods).not.toHaveBeenCalled();
    await expect(provider.redactCustomer('cus_1')).rejects.toEqual(
      new PaymentsUnavailableError('PROVIDER'),
    );
  });
});
