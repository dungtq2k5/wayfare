// Integration suites run against the paired _test database (ADR 0034) and a separate NATS server,
// with the fake providers, so nothing reaches a running narration or a real provider.
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
  TRANSLATION_PROVIDER_ORDER: 'fake',
  TTS_PROVIDER_ORDER: 'fake',
  FAKE_PROVIDER_FAILURES: '',
  GCS_BUCKET_MEDIA: 'wayfare-media-test',
  GCS_PUBLIC_BASE_URL: 'http://localhost:4443/wayfare-media-test',
});
