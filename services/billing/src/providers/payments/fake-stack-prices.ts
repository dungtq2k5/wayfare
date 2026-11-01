import { FakePaymentsProvider } from './fake.payments-provider';
import type { ProviderPrice } from './payments-provider';

const price = (overrides: Partial<ProviderPrice> & Pick<ProviderPrice, 'id'>): ProviderPrice => ({
  active: true,
  currency: 'usd',
  unitAmount: 900,
  recurringInterval: 'month',
  productId: 'prod_dev_growth',
  ...overrides,
});

/**
 * The prices the stack's fake Stripe knows, fixed in code: nothing adds one at run time. The dev
 * seed's `price_dev_*` (already registered, so `taken`), a second Growth monthly ($12.00), and one
 * for each refusal — in EUR, inactive, on another product. Any other id is not found.
 */
export const STACK_PRICES: readonly ProviderPrice[] = [
  price({ id: 'price_dev_growth_month' }),
  price({ id: 'price_dev_growth_year', unitAmount: 9000, recurringInterval: 'year' }),
  price({ id: 'price_dev_pro_month', unitAmount: 2900, productId: 'prod_dev_pro' }),
  price({
    id: 'price_dev_pro_year',
    unitAmount: 29000,
    recurringInterval: 'year',
    productId: 'prod_dev_pro',
  }),
  price({ id: 'price_testGrowthMonthly2', unitAmount: 1200 }),
  price({ id: 'price_testEur', currency: 'eur' }),
  price({ id: 'price_testInactive', active: false }),
  price({ id: 'price_testOtherProduct', productId: 'prod_test_other' }),
];

/** The fake Stripe of a local or CI stack (`PAYMENTS_PROVIDER=fake`), its prices seeded. */
export function stackFakePayments(): FakePaymentsProvider {
  const fake = new FakePaymentsProvider();
  for (const row of STACK_PRICES) fake.prices.set(row.id, row);
  return fake;
}
