import { newId } from '@wayfare/contracts';
import { PaymentsProvider, PaymentsUnavailableError } from './payments-provider';
import type {
  ProviderInvoice,
  ProviderPrice,
  SubscriptionCheckoutInput,
} from './payments-provider';

/**
 * Stripe's API calls in memory, for tests and a keyless local stack's specs: prices, subscriptions
 * and invoices are what a test puts here. `unavailable` makes every call reject as Stripe down.
 */
export class FakePaymentsProvider extends PaymentsProvider {
  /** False plays a stack with no key configured. */
  configured = true;
  unavailable = false;
  readonly prices = new Map<string, ProviderPrice>();
  readonly subscriptions = new Map<string, Record<string, unknown>>();
  readonly invoices = new Map<string, ProviderInvoice[]>();
  readonly customers = new Map<string, string>();
  readonly checkouts: SubscriptionCheckoutInput[] = [];
  readonly redacted: string[] = [];
  readonly calls: string[] = [];

  createCustomer(input: {
    readonly billingAccountId: string;
    readonly ownerUserId: string;
  }): Promise<{ customerId: string }> {
    return this.answer('createCustomer', () => {
      // Idempotent by the account id, as Stripe's key makes it.
      const existing = this.customers.get(input.billingAccountId);
      const customerId = existing ?? `cus_fake${newId().replaceAll('-', '').slice(-12)}`;
      this.customers.set(input.billingAccountId, customerId);
      return { customerId };
    });
  }

  createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<{ url: string }> {
    return this.answer('createSubscriptionCheckout', () => {
      this.checkouts.push(input);
      return { url: `https://checkout.stripe.test/c/${input.idempotencyKey}` };
    });
  }

  createPortalSession(input: {
    readonly customerId: string;
    readonly returnUrl: string;
  }): Promise<{ url: string }> {
    return this.answer('createPortalSession', () => ({
      url: `https://billing.stripe.test/p/${input.customerId}`,
    }));
  }

  listInvoices(customerId: string): Promise<ProviderInvoice[]> {
    return this.answer('listInvoices', () => this.invoices.get(customerId) ?? []);
  }

  retrievePrice(priceId: string): Promise<ProviderPrice> {
    return this.answer('retrievePrice', () => {
      const price = this.prices.get(priceId);
      if (price === undefined) throw new PaymentsUnavailableError('PROVIDER');
      return price;
    });
  }

  retrieveSubscription(subscriptionId: string): Promise<Record<string, unknown>> {
    return this.answer('retrieveSubscription', () => {
      const subscription = this.subscriptions.get(subscriptionId);
      if (subscription === undefined) throw new PaymentsUnavailableError('PROVIDER');
      return subscription;
    });
  }

  redactCustomer(customerId: string): Promise<void> {
    return this.answer('redactCustomer', () => {
      this.redacted.push(customerId);
    });
  }

  private async answer<T>(operation: string, run: () => T): Promise<T> {
    this.calls.push(operation);
    await Promise.resolve();
    if (this.unavailable) throw new PaymentsUnavailableError('PROVIDER');
    return run();
  }
}
