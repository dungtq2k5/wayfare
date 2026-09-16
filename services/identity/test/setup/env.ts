// Integration and contract suites run against the paired _test database (ADR 0034) and a separate
// NATS server: the service reads DATABASE_URL and NATS_URL, so both are repointed before anything connects.
import { resolve } from 'node:path';
import { config } from 'dotenv';

config({ path: resolve(__dirname, '../../.env'), quiet: true });
if (!process.env.DATABASE_URL_TEST)
  throw new Error('DATABASE_URL_TEST is not set — copy .env.example to .env');
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
// Likewise the broker: a separate NATS server, so test events never reach a running identity.
if (!process.env.NATS_URL_TEST)
  throw new Error('NATS_URL_TEST is not set — copy .env.example to .env');
process.env.NATS_URL = process.env.NATS_URL_TEST;
