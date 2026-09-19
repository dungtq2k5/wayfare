/** How long one Stripe call may take (conventions §11.5). */
export const STRIPE_TIMEOUT_MS = 10_000;

/** Stripe could not answer, or no key is configured. Never carries a card, a key or an email. */
export class PaymentsUnavailableError extends Error {
  constructor(readonly reason: 'NOT_CONFIGURED' | 'PROVIDER') {
    super(`payments unavailable: ${reason}`);
    this.name = 'PaymentsUnavailableError';
  }
}

/** A Stripe Price, as a registration reads it. */
export interface ProviderPrice {
  readonly id: string;
  readonly active: boolean;
  readonly currency: string;
  /** Minor units; null for a tiered or metered price. */
  readonly unitAmount: number | null;
  /** `month`, `year`, or null for a one-off price. */
  readonly recurringInterval: string | null;
  readonly productId: string;
}

/** An invoice, as the owner's list shows it. */
export interface ProviderInvoice {
  readonly id: string;
  readonly number: string | null;
  readonly status: string;
  readonly total: number;
  readonly amountPaid: number;
  readonly currency: string;
  /** Stripe's `created`, seconds. */
  readonly created: number;
  readonly hostedInvoiceUrl: string | null;
  readonly invoicePdf: string | null;
}

/** A Checkout Session for a subscription (api-endpoints-plan §5.1). */
export interface SubscriptionCheckoutInput {
  readonly customerId: string;
  readonly priceId: string;
  /** `client_reference_id`: the billing account the webhook links back to. */
  readonly billingAccountId: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  /** The route's `Idempotency-Key`, forwarded as Stripe's own. */
  readonly idempotencyKey: string;
  /** When the session stops being payable (api-endpoints-plan §5.1). */
  readonly expiresAt: Date;
}

/**
 * Every Stripe API call billing makes (conventions §11.5): the real adapter, or a fake in tests.
 * Each method rejects with `PaymentsUnavailableError` when Stripe cannot be reached or no key is
 * configured. Webhook verification is not here: it is `StripeWebhookVerifier`, never faked.
 */
export abstract class PaymentsProvider {
  /** Whether a key is configured; without one every call rejects. */
  abstract readonly configured: boolean;

  /** A Customer for the account, idempotent by the account id. */
  abstract createCustomer(input: {
    readonly billingAccountId: string;
    readonly ownerUserId: string;
  }): Promise<{ customerId: string }>;

  abstract createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<{ url: string }>;

  abstract createPortalSession(input: {
    readonly customerId: string;
    readonly returnUrl: string;
  }): Promise<{ url: string }>;

  abstract listInvoices(customerId: string): Promise<ProviderInvoice[]>;

  abstract retrievePrice(priceId: string): Promise<ProviderPrice>;

  /** The subscription as Stripe holds it now: the same object shape an event carries. */
  abstract retrieveSubscription(subscriptionId: string): Promise<Record<string, unknown>>;

  /**
   * Erasure (api-endpoints-plan §10): clears the customer's email, name, phone and address and
   * detaches every payment method, keeping the customer, its metadata and its invoices. Idempotent;
   * a customer Stripe no longer has counts as done.
   */
  abstract redactCustomer(customerId: string): Promise<void>;
}
