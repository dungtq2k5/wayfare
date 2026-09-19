import { Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PaymentsProvider, PaymentsUnavailableError, STRIPE_TIMEOUT_MS } from './payments-provider';
import type {
  ProviderInvoice,
  ProviderPrice,
  SubscriptionCheckoutInput,
} from './payments-provider';

/** The Stripe API version billing is written against (architecture §5): upgraded deliberately. */
export const STRIPE_API_VERSION = '2026-08-26.dahlia';

/** Checkout's `integration_identifier`, so the Dashboard can tell our flows apart (architecture §5.1). */
const CHECKOUT_INTEGRATION = 'wayfare-owner-subscription';

/** How many invoices the owner's list shows. */
const INVOICE_LIMIT = 24;

/**
 * The real Stripe adapter — the only file besides the webhook verifier that imports `stripe`
 * (conventions §11.5). Without a key it is constructed unconfigured, and every call rejects with
 * `PaymentsUnavailableError`, so the three Stripe-backed owner routes answer 503.
 */
export class StripePaymentsProvider extends PaymentsProvider {
  private readonly logger = new Logger(StripePaymentsProvider.name);
  private readonly stripe: Stripe | null;

  constructor(secretKey: string | undefined) {
    super();
    this.stripe =
      secretKey === undefined
        ? null
        : new Stripe(secretKey, {
            apiVersion: STRIPE_API_VERSION,
            timeout: STRIPE_TIMEOUT_MS,
            maxNetworkRetries: 1,
            appInfo: { name: 'wayfare-billing' },
          });
  }

  get configured(): boolean {
    return this.stripe !== null;
  }

  async createCustomer(input: {
    readonly billingAccountId: string;
    readonly ownerUserId: string;
  }): Promise<{ customerId: string }> {
    const customer = await this.call('createCustomer', (stripe) =>
      stripe.customers.create(
        { metadata: { ownerUserId: input.ownerUserId, billingAccountId: input.billingAccountId } },
        { idempotencyKey: `customer:${input.billingAccountId}` },
      ),
    );
    return { customerId: customer.id };
  }

  async createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<{ url: string }> {
    const session = await this.call('createSubscriptionCheckout', (stripe) =>
      stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          customer: input.customerId,
          client_reference_id: input.billingAccountId,
          line_items: [{ price: input.priceId, quantity: 1 }],
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          integration_identifier: CHECKOUT_INTEGRATION,
          expires_at: Math.floor(input.expiresAt.getTime() / 1000),
        },
        { idempotencyKey: input.idempotencyKey },
      ),
    );
    if (session.url === null) throw new PaymentsUnavailableError('PROVIDER');
    return { url: session.url };
  }

  async createPortalSession(input: {
    readonly customerId: string;
    readonly returnUrl: string;
  }): Promise<{ url: string }> {
    const session = await this.call('createPortalSession', (stripe) =>
      stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      }),
    );
    return { url: session.url };
  }

  async listInvoices(customerId: string): Promise<ProviderInvoice[]> {
    const page = await this.call('listInvoices', (stripe) =>
      stripe.invoices.list({ customer: customerId, limit: INVOICE_LIMIT }),
    );
    return page.data.map((invoice) => ({
      id: invoice.id ?? '',
      number: invoice.number,
      status: invoice.status ?? 'draft',
      total: invoice.total,
      amountPaid: invoice.amount_paid,
      currency: invoice.currency,
      created: invoice.created,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      invoicePdf: invoice.invoice_pdf ?? null,
    }));
  }

  async retrievePrice(priceId: string): Promise<ProviderPrice> {
    const price = await this.call('retrievePrice', (stripe) => stripe.prices.retrieve(priceId));
    return {
      id: price.id,
      active: price.active,
      currency: price.currency,
      unitAmount: price.unit_amount,
      recurringInterval: price.recurring?.interval ?? null,
      productId: typeof price.product === 'string' ? price.product : price.product.id,
    };
  }

  async retrieveSubscription(subscriptionId: string): Promise<Record<string, unknown>> {
    const subscription = await this.call('retrieveSubscription', (stripe) =>
      stripe.subscriptions.retrieve(subscriptionId),
    );
    return subscription as unknown as Record<string, unknown>;
  }

  async redactCustomer(customerId: string): Promise<void> {
    await this.call('redactCustomer', async (stripe) => {
      try {
        await stripe.customers.update(customerId, { email: '', name: '', phone: '', address: '' });
      } catch (error) {
        if (isMissing(error)) return;
        throw error;
      }
      for await (const method of stripe.customers.listPaymentMethods(customerId, { limit: 100 })) {
        await stripe.paymentMethods.detach(method.id);
      }
    });
  }

  /** One call; a Stripe or network error becomes `PaymentsUnavailableError`, its class name logged. */
  private async call<T>(operation: string, run: (stripe: Stripe) => Promise<T>): Promise<T> {
    if (this.stripe === null) throw new PaymentsUnavailableError('NOT_CONFIGURED');
    try {
      return await run(this.stripe);
    } catch (error) {
      this.logger.warn(
        { operation, kind: error instanceof Error ? error.name : 'unknown' },
        'Stripe call failed',
      );
      throw new PaymentsUnavailableError('PROVIDER');
    }
  }
}

/** Stripe's answer for an object it does not have, such as a customer deleted in the Dashboard. */
function isMissing(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing'
  );
}
