import { SubscriptionStatus } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import {
  accountKeys,
  checkoutFacts,
  eventRoute,
  invoiceFacts,
  staleness,
  subscriptionFacts,
} from './subscription-event';

const subscription = {
  id: 'sub_1',
  object: 'subscription',
  customer: 'cus_1',
  status: 'active',
  cancel_at_period_end: false,
  items: {
    data: [{ price: { id: 'price_1' }, current_period_start: 1_000, current_period_end: 2_000 }],
  },
};

describe('eventRoute', () => {
  it('handles R1 and ignores the rest', () => {
    expect(eventRoute('customer.subscription.deleted')).toBe('SUBSCRIPTION');
    expect(eventRoute('checkout.session.completed')).toBe('CHECKOUT');
    expect(eventRoute('invoice.payment_failed')).toBe('INVOICE_FAILED');
    expect(eventRoute('invoice.paid')).toBe('INVOICE_PAID');
    expect(eventRoute('charge.refunded')).toBe('IGNORED');
  });
});

describe('staleness', () => {
  const guard = new Date(10_000);
  it('orders by whole seconds, a tie being its own case', () => {
    expect(staleness(new Date(9_000), guard)).toBe('STALE');
    expect(staleness(new Date(10_000), guard)).toBe('TIE');
    expect(staleness(new Date(11_000), guard)).toBe('NEWER');
    expect(staleness(new Date(1), null)).toBe('NEWER');
  });
});

describe('subscriptionFacts', () => {
  it('reads the item period, and the subscription period on older versions', () => {
    expect(subscriptionFacts(subscription)).toEqual({
      subscriptionId: 'sub_1',
      customerId: 'cus_1',
      status: SubscriptionStatus.ACTIVE,
      priceId: 'price_1',
      currentPeriodStart: new Date(1_000_000),
      currentPeriodEnd: new Date(2_000_000),
      cancelAtPeriodEnd: false,
    });
    const legacy = {
      ...subscription,
      customer: { id: 'cus_1' },
      current_period_end: 3_000,
      items: { data: [{ price: { id: 'price_1' } }] },
    };
    expect(subscriptionFacts(legacy).currentPeriodEnd).toEqual(new Date(3_000_000));
  });

  it('refuses an unknown status', () => {
    expect(() => subscriptionFacts({ ...subscription, status: 'weird' })).toThrow();
  });
});

describe('checkout and invoice facts', () => {
  it('reads the links and the dunning fields', () => {
    expect(
      checkoutFacts({
        mode: 'subscription',
        client_reference_id: 'acc',
        customer: 'cus_1',
        subscription: 'sub_1',
      }),
    ).toEqual({
      subscriptionMode: true,
      clientReferenceId: 'acc',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
    });
    expect(
      invoiceFacts({
        customer: 'cus_1',
        attempt_count: 2,
        next_payment_attempt: 5_000,
        parent: { subscription_details: { subscription: 'sub_1' } },
      }),
    ).toEqual({
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      attemptCount: 2,
      nextAttemptAt: new Date(5_000_000),
    });
  });

  it('finds an account key in any object, or none', () => {
    expect(accountKeys(subscription)).toEqual({
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      clientReferenceId: null,
    });
    expect(accountKeys('nope')).toEqual({
      customerId: null,
      subscriptionId: null,
      clientReferenceId: null,
    });
  });
});
