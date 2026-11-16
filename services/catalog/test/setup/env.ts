// Integration suites run against the paired _test database (ADR 0034), a separate NATS server and
// a bucket of their own on the storage emulator, so nothing reaches a running catalog.
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
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS)
  throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not set — run `pnpm keys:dev`');
const bucket = 'wayfare-media-test';
Object.assign(process.env, {
  GCS_BUCKET_MEDIA: bucket,
  GCS_PUBLIC_BASE_URL: `${process.env.GCS_API_ENDPOINT ?? 'http://localhost:4443'}/${bucket}`,
});
