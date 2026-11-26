import { FREE_PLAN_GRANTS, SubscriptionStatus } from '@wayfare/contracts';
import { buildAccountContext } from '@wayfare/nest-common/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentsUnavailableError } from '../../providers/payments/payments-provider';
import { SubscriptionsService } from './subscriptions.service';

const ID = '01990000-0000-7000-8000-000000000001';
const caller = buildAccountContext();
const account = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  ownerUserId: caller.userId,
  stripeCustomerId: null,
  planPriceId: null,
  subscriptionStatus: SubscriptionStatus.NONE,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  dunningStartedAt: null,
  entitlementsPinned: false,
  plan: { id: ID, code: 'FREE', name: 'Free' },
  ...FREE_PLAN_GRANTS,
  ...overrides,
});

const prisma = {
  billingAccount: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
  planPrice: { findUnique: vi.fn() },
  discoveryBoost: { count: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn((run: (tx: unknown) => unknown) => run('tx')),
};
const outbox = { add: vi.fn() };
const payments = {
  createCustomer: vi.fn(),
  createSubscriptionCheckout: vi.fn(),
  createPortalSession: vi.fn(),
  listInvoices: vi.fn(),
};
const catalog = { countOwnerPlaces: vi.fn() };
const redis = { get: vi.fn(), set: vi.fn() };
const config = { get: () => 'https://console.test' };
const service = new SubscriptionsService(
  prisma as never,
  outbox as never,
  payments as never,
  catalog as never,
  redis,
  config as never,
);

beforeEach(() => {
  vi.clearAllMocks();
  prisma.billingAccount.findUnique.mockResolvedValue(account());
  redis.set.mockResolvedValue('OK');
});

describe('the owner’s billing overview', () => {
  it('shows the price, period end, dunning and Venue count when there are some', async () => {
    const since = new Date('2026-11-01T00:00:00Z');
    prisma.billingAccount.findUnique.mockResolvedValue(
      account({ planPriceId: ID, currentPeriodEnd: since, dunningStartedAt: since }),
    );
    prisma.planPrice.findUnique.mockResolvedValue({
      id: ID,
      stripePriceId: 'price_1',
      billingInterval: 'MONTH',
      amountMinor: 900,
      currency: 'USD',
      isActive: true,
      createdAt: since,
      updatedAt: since,
    });
    catalog.countOwnerPlaces.mockResolvedValue(3);
    prisma.billingAccount.findUniqueOrThrow.mockResolvedValue({ plan: FREE_PLAN_GRANTS });
    prisma.discoveryBoost.count.mockResolvedValue(1);
    const overview = await service.getOverview(caller);
    expect(overview).toMatchObject({
      usagePlaces: 3,
      usageBoostsLive: 1,
      price: { amountMinor: 900 },
    });
    expect(overview.currentPeriodEnd).toBeDefined();
    expect(overview.dunningSince).toBeDefined();
  });

  it('leaves out the Venue count when catalog can’t give it', async () => {
    catalog.countOwnerPlaces.mockResolvedValue(null);
    prisma.billingAccount.findUniqueOrThrow.mockResolvedValue({ plan: FREE_PLAN_GRANTS });
    prisma.discoveryBoost.count.mockResolvedValue(0);
    const overview = await service.getOverview(caller);
    expect(overview).not.toHaveProperty('usagePlaces');
    expect(overview.price).toBeUndefined();
    expect(prisma.planPrice.findUnique).not.toHaveBeenCalled();
  });
});

describe('a Checkout', () => {
  const request = { planPriceId: ID, idempotencyKey: ID };

  it.each([
    ['no such price', null],
    ['a retired price', { id: ID, stripePriceId: 'p', isActive: false, plan: { deletedAt: null } }],
    [
      'a deleted plan’s price',
      { id: ID, stripePriceId: 'p', isActive: true, plan: { deletedAt: new Date() } },
    ],
  ])('is refused for %s', async (_case, price) => {
    prisma.planPrice.findUnique.mockResolvedValue(price);
    await expect(service.createCheckoutSession(request, caller)).rejects.toMatchObject({
      message: expect.stringContaining('RESOURCE_NOT_FOUND'),
    });
    expect(payments.createSubscriptionCheckout).not.toHaveBeenCalled();
  });

  it('reuses the customer the account already has', async () => {
    prisma.billingAccount.findUnique.mockResolvedValue(account({ stripeCustomerId: 'cus_1' }));
    prisma.planPrice.findUnique.mockResolvedValue({
      id: ID,
      stripePriceId: 'price_1',
      isActive: true,
      plan: { deletedAt: null },
    });
    payments.createSubscriptionCheckout.mockResolvedValue({ url: 'https://checkout' });
    await expect(service.createCheckoutSession(request, caller)).resolves.toEqual({
      url: 'https://checkout',
    });
    expect(payments.createCustomer).not.toHaveBeenCalled();
    expect(payments.createSubscriptionCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_1', priceId: 'price_1' }),
    );
  });

  it('lets a failure other than Stripe being unavailable through as it is', async () => {
    prisma.planPrice.findUnique.mockResolvedValue({
      id: ID,
      stripePriceId: 'price_1',
      isActive: true,
      plan: { deletedAt: null },
    });
    const bug = new TypeError('bug');
    payments.createCustomer.mockRejectedValue(bug);
    await expect(service.createCheckoutSession(request, caller)).rejects.toBe(bug);
    payments.createCustomer.mockRejectedValue(new PaymentsUnavailableError('PROVIDER'));
    await expect(service.createCheckoutSession(request, caller)).rejects.toMatchObject({
      message: expect.stringContaining('UPSTREAM_UNAVAILABLE'),
    });
  });
});

describe('the portal and invoices', () => {
  it('opens the portal for the account’s customer, back to the billing page, audited', async () => {
    prisma.billingAccount.findUnique.mockResolvedValue(account({ stripeCustomerId: 'cus_1' }));
    payments.createPortalSession.mockResolvedValue({ url: 'https://portal' });
    await expect(service.createPortalSession(caller)).resolves.toEqual({ url: 'https://portal' });
    expect(payments.createPortalSession).toHaveBeenCalledWith({
      customerId: 'cus_1',
      returnUrl: 'https://console.test/owner/billing',
    });
    expect(outbox.add).toHaveBeenCalledTimes(1);
  });

  it('reads cached invoices without asking Stripe, carrying the number and links they have', async () => {
    prisma.billingAccount.findUnique.mockResolvedValue(account({ stripeCustomerId: 'cus_1' }));
    redis.get.mockResolvedValue(
      JSON.stringify([
        {
          id: 'in_1',
          number: 'A-1',
          status: 'paid',
          total: 900,
          amountPaid: 900,
          currency: 'usd',
          created: 1,
          hostedInvoiceUrl: 'https://hosted',
          invoicePdf: 'https://pdf',
        },
      ]),
    );
    const { invoices } = await service.listInvoices(caller);
    expect(invoices[0]).toMatchObject({
      number: 'A-1',
      currency: 'USD',
      hostedInvoiceUrl: 'https://hosted',
      invoicePdfUrl: 'https://pdf',
    });
    expect(payments.listInvoices).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('asks Stripe when the cache can’t be read, and still answers when it can’t be written', async () => {
    prisma.billingAccount.findUnique.mockResolvedValue(account({ stripeCustomerId: 'cus_1' }));
    redis.get.mockRejectedValue(new Error('redis down'));
    redis.set.mockRejectedValue(new Error('redis down'));
    payments.listInvoices.mockResolvedValue([]);
    await expect(service.listInvoices(caller)).resolves.toEqual({ invoices: [] });
    expect(payments.listInvoices).toHaveBeenCalledWith('cus_1');
  });

  it('gives the owner summary its dunning date when payment is failing', async () => {
    prisma.billingAccount.findUnique.mockResolvedValue(account({ dunningStartedAt: new Date() }));
    const summary = await service.getBillingSummary({ ownerUserId: caller.userId });
    expect(summary).toMatchObject({ billingAccountId: ID, planCode: 'FREE' });
    expect(summary.dunningSince).toBeDefined();
  });
});
