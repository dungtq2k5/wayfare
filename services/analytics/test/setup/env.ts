// Integration suites run against the paired _test database (ADR 0034) and their own Redis database
// (index 9), so nothing reaches a running analytics or the developer's counters.
import { resolve } from 'node:path';
import { config } from 'dotenv';

// `override`: a worker inherits the runner's environment, which may hold another service's values.
config({ path: resolve(__dirname, '../../.env'), quiet: true, override: true });
if (!process.env.DATABASE_URL_TEST)
  throw new Error('DATABASE_URL_TEST is not set — copy .env.example to .env');
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
const redis = new URL(process.env.REDIS_URL ?? 'redis://localhost:16379');
redis.pathname = '/9';
process.env.REDIS_URL = redis.toString();
