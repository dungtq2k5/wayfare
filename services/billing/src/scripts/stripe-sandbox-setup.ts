// pnpm --filter @wayfare/billing stripe:sandbox-setup — creates the paid plans' Products and their
// monthly and annual Prices in a Stripe sandbox, at product-overview §8.2's amounts, and prints the
// STRIPE_PRICE_* lines for billing's .env. Idempotent by lookup key; refuses a live key. A CLI tool,
// not service code: it talks to Stripe's Products API, which the running service never needs.
import 'dotenv/config';
import Stripe from 'stripe';
import { STRIPE_API_VERSION } from '../providers/payments/stripe.payments-provider';

const PLANS = [
  { code: 'GROWTH', name: 'Wayfare Growth', monthly: 900, annual: 9000 },
  { code: 'PRO', name: 'Wayfare Pro', monthly: 2900, annual: 29000 },
] as const;

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Set STRIPE_SECRET_KEY to a sandbox key (rk_test_… or sk_test_…)');
  if (!/^(rk|sk)_test_/.test(key)) throw new Error('stripe:sandbox-setup refuses a live key');
  const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  const lines: string[] = [];
  for (const plan of PLANS) {
    const lookup = {
      monthly: `wayfare_${plan.code.toLowerCase()}_monthly`,
      annual: `wayfare_${plan.code.toLowerCase()}_annual`,
    };
    const existing = await stripe.prices.list({
      lookup_keys: [lookup.monthly, lookup.annual],
      expand: ['data.product'],
    });
    const found = new Map(existing.data.map((price) => [price.lookup_key, price]));
    const product =
      existing.data[0] === undefined
        ? await stripe.products.create({ name: plan.name, metadata: { planCode: plan.code } })
        : {
            id:
              typeof existing.data[0].product === 'string'
                ? existing.data[0].product
                : existing.data[0].product.id,
          };
    for (const [interval, lookupKey, amount] of [
      ['month', lookup.monthly, plan.monthly],
      ['year', lookup.annual, plan.annual],
    ] as const) {
      const price =
        found.get(lookupKey) ??
        (await stripe.prices.create({
          product: product.id,
          currency: 'usd',
          unit_amount: amount,
          recurring: { interval },
          lookup_key: lookupKey,
        }));
      const suffix = interval === 'month' ? 'MONTHLY' : 'ANNUAL';
      lines.push(`STRIPE_PRICE_${plan.code}_${suffix}=${price.id}`);
    }
  }
  console.log('# Paste into services/billing/.env, then run `pnpm seed:dev`:');
  for (const line of lines) console.log(line);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
