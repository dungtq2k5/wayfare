import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingEventStatus, BillingInterval, newId, StripeEndpoint } from '@wayfare/contracts';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import { parseRpcRequest, rpcError } from '@wayfare/nest-common';
import { z } from 'zod';
import type { Env } from '../../config/env.schema';
import { FakePaymentsProvider } from '../../providers/payments/fake.payments-provider';
import { PaymentsProvider } from '../../providers/payments/payments-provider';
import { PrismaService } from '../prisma/prisma.service';
import { stripeInstant } from '../webhooks/domain/subscription-event';
import { WebhooksService } from '../webhooks/webhooks.service';

const sessionField = z.object({ sessionId: z.string().min(1).max(255) });
const MONTH_SECONDS = 30 * 86_400;
const YEAR_SECONDS = 365 * 86_400;

/**
 * Paying a fake Checkout on a local or CI stack (`PAYMENTS_PROVIDER=fake`, which production
 * refuses): the three events a paid Checkout sends — the session completed, the subscription
 * created, the invoice paid — recorded `RECEIVED` and queued as Stripe's own would be, so the
 * owner's return races them as it does for real. Each is a second apart in `created`; the fake
 * also holds the subscription, should the order guard's tie re-read it.
 */
@Injectable()
export class FakeCheckoutService {
  private readonly production: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsProvider,
    private readonly webhooks: WebhooksService,
    config: ConfigService<Env, true>,
  ) {
    this.production = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  async pay(
    request: billingGrpc.PayFakeCheckoutRequest,
  ): Promise<billingGrpc.PayFakeCheckoutResponse> {
    const fake = this.payments;
    if (this.production || !(fake instanceof FakePaymentsProvider)) {
      throw rpcError('RESOURCE_NOT_FOUND', { resource: 'CHECKOUT_SESSION' });
    }
    const { sessionId } = parseRpcRequest(sessionField, request);
    const checkout = fake.checkoutSession(sessionId);
    if (checkout === undefined)
      throw rpcError('RESOURCE_NOT_FOUND', { resource: 'CHECKOUT_SESSION' });
    // Billing's own record of the price: a stack's plans may hold prices the fake doesn't list.
    const price = await this.prisma.planPrice.findUnique({
      where: { stripePriceId: checkout.priceId },
      select: { billingInterval: true, amountMinor: true, currency: true },
    });
    if (price === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'CHECKOUT_SESSION' });
    const now = Math.floor(Date.now() / 1000);
    const period =
      price.billingInterval === String(BillingInterval.YEAR) ? YEAR_SECONDS : MONTH_SECONDS;
    const tag = newId().replaceAll('-', '').slice(-12);
    const subscriptionId = `sub_fake${tag}`;
    const subscription = {
      id: subscriptionId,
      object: 'subscription',
      customer: checkout.customerId,
      status: 'active',
      cancel_at_period_end: false,
      items: {
        object: 'list',
        data: [
          {
            price: { id: checkout.priceId },
            current_period_start: now,
            current_period_end: now + period,
          },
        ],
      },
    };
    fake.subscriptions.set(subscriptionId, subscription);
    const invoiceId = `in_fake${tag}`;
    fake.invoices.set(checkout.customerId, [
      {
        id: invoiceId,
        number: `FAKE-${tag.slice(-6).toUpperCase()}`,
        status: 'paid',
        total: price.amountMinor,
        amountPaid: price.amountMinor,
        currency: price.currency.toLowerCase(),
        created: now,
        // Placeholders, as the fake's other Stripe pages: the invoice's row has something to open.
        hostedInvoiceUrl: `https://invoice.stripe.test/${invoiceId}`,
        invoicePdf: `https://invoice.stripe.test/${invoiceId}/pdf`,
      },
      ...(fake.invoices.get(checkout.customerId) ?? []),
    ]);
    const events = [
      {
        type: 'checkout.session.completed',
        created: now - 2,
        object: {
          id: `cs_fake${tag}`,
          object: 'checkout.session',
          mode: 'subscription',
          client_reference_id: checkout.billingAccountId,
          customer: checkout.customerId,
          subscription: subscriptionId,
        },
      },
      { type: 'customer.subscription.created', created: now - 1, object: subscription },
      {
        type: 'invoice.paid',
        created: now,
        object: {
          id: invoiceId,
          object: 'invoice',
          customer: checkout.customerId,
          subscription: subscriptionId,
          attempt_count: 1,
        },
      },
    ];
    for (const [index, event] of events.entries()) {
      const stripeEventId = `evt_fake${tag}${index + 1}`;
      const row = await this.prisma.billingEvent.create({
        data: {
          stripeEventId,
          endpoint: StripeEndpoint.PLATFORM,
          livemode: false,
          eventType: event.type,
          stripeCreatedAt: stripeInstant(event.created),
          billingAccountId: checkout.billingAccountId,
          payload: {
            id: stripeEventId,
            object: 'event',
            type: event.type,
            created: event.created,
            livemode: false,
            data: { object: event.object },
          },
          status: BillingEventStatus.RECEIVED,
        },
        select: { id: true },
      });
      await this.webhooks.enqueue({ billingEventId: row.id, attempt: 1 });
    }
    return { successUrl: checkout.successUrl };
  }
}
