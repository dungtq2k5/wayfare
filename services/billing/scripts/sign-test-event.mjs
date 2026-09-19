#!/usr/bin/env node
// Signs a Stripe event for the local walks with the SDK's own test helper and billing's local
// webhook secret (services/billing/.env), and prints the `Stripe-Signature` header value.
//
// Usage: node services/billing/scripts/sign-test-event.mjs < event.json
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '../package.json'));
const Stripe = require('stripe');
const { parse } = require('dotenv');

const secret =
  process.env.STRIPE_WEBHOOK_SECRET ||
  parse(readFileSync(resolve(here, '../.env'))).STRIPE_WEBHOOK_SECRET;
if (!secret) {
  console.error('STRIPE_WEBHOOK_SECRET is not set — run `pnpm keys:dev`');
  process.exit(1);
}
const payload = readFileSync(0, 'utf8');
process.stdout.write(Stripe.webhooks.generateTestHeaderString({ payload, secret }));
