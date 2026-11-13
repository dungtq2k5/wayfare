// Integration suites run against the paired _test database (ADR 0034) and a separate NATS server,
// with no Stripe key and a fixed webhook secret, so nothing reaches a running billing or Stripe.
import { resolve } from 'node:path';
import { config } from 'dotenv';

// `override`: a worker inherits the runner's environment, which may hold another service's values.
config({ path: resolve(__dirname, '../../.env'), quiet: true, override: true });
if (!process.env.DATABASE_URL_TEST)
  throw new Error('DATABASE_URL_TEST is not set — copy .env.example to .env');
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
if (!process.env.NATS_URL_TEST)
  throw new Error('NATS_URL_TEST is not set — copy .env.example to .env');
process.env.NATS_URL = process.env.NATS_URL_TEST;
Object.assign(process.env, {
  STRIPE_MODE: 'test',
  STRIPE_SECRET_KEY: '',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_integration',
});
