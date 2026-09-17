// Integration and contract suites run against the paired _test database (ADR 0034) and a separate
// NATS server: the service reads DATABASE_URL and NATS_URL, so both are repointed before anything connects.
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { generateTestSigningKeys } from '@wayfare/nest-common/testing';
import { config } from 'dotenv';

// `override`: a worker inherits the runner's environment, which may hold another service's values.
config({ path: resolve(__dirname, '../../.env'), quiet: true, override: true });
if (!process.env.DATABASE_URL_TEST)
  throw new Error('DATABASE_URL_TEST is not set — copy .env.example to .env');
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
// Likewise the broker: a separate NATS server, so test events never reach a running identity.
if (!process.env.NATS_URL_TEST)
  throw new Error('NATS_URL_TEST is not set — copy .env.example to .env');
process.env.NATS_URL = process.env.NATS_URL_TEST;
// Suites sign with a throwaway key, never the .env one: a `pnpm keys:dev` rerun cannot break a run.
const keys = generateTestSigningKeys();
process.env.JWT_PRIVATE_KEY = keys.privateKey;
process.env.JWT_KEY_ID = keys.keyId;
// Email: SMTP to the local catcher in restricted mode, with a per-run hash key — never the .env one.
Object.assign(process.env, {
  EMAIL_PROVIDER: 'smtp',
  SMTP_URL: process.env.SMTP_URL ?? 'smtp://localhost:1025',
  EMAIL_FROM: 'Wayfare <no-reply@wayfare.local>',
  EMAIL_DELIVERY_MODE: 'restricted',
  EMAIL_NONPROD_ALLOWLIST: '*@example.com,*@wayfare.local',
  EMAIL_NONPROD_CATCHALL: 'team@wayfare.local',
  EMAIL_HASH_KEY: randomBytes(32).toString('base64'),
  CONSOLE_URL: 'http://console.localhost',
  WEB_URL: 'http://web.localhost',
});
