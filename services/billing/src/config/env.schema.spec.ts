import { describe, expect, it } from 'vitest';
import { envSchema } from './env.schema';

const valid = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://wayfare:wayfare@localhost:15436/wayfare_billing',
  NATS_URL: 'nats://localhost:14222',
  REDIS_URL: 'redis://localhost:16379',
  GRPC_URL: '0.0.0.0:50054',
  OPS_PORT: '3104',
  METRICS_PORT: '9104',
  CATALOG_GRPC_URL: 'localhost:50052',
  CONSOLE_URL: 'http://localhost:5173/',
  STRIPE_WEBHOOK_SECRET: 'whsec_local',
};

const parse = (over: Record<string, string>) => envSchema.parse({ ...valid, ...over });

describe('billing env schema', () => {
  it('runs in test mode without a key, and trims the console URL', () => {
    const env = parse({ STRIPE_SECRET_KEY: '' });
    expect(env.STRIPE_MODE).toBe('test');
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.CONSOLE_URL).toBe('http://localhost:5173');
  });

  it('takes the mode from the key: rk_test_ in test, rk_live_ in live, never sk_', () => {
    expect(parse({ STRIPE_SECRET_KEY: 'rk_test_abc' }).STRIPE_MODE).toBe('test');
    expect(parse({ STRIPE_MODE: 'live', STRIPE_SECRET_KEY: 'rk_live_abc' }).STRIPE_MODE).toBe(
      'live',
    );
    expect(() => parse({ STRIPE_SECRET_KEY: 'rk_live_abc' })).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => parse({ STRIPE_MODE: 'live', STRIPE_SECRET_KEY: 'rk_test_abc' })).toThrow(
      /STRIPE_SECRET_KEY/,
    );
    expect(() => parse({ STRIPE_SECRET_KEY: 'sk_test_abc' })).toThrow(/never sk_/);
    expect(() => parse({ STRIPE_MODE: 'live' })).toThrow(/Required in live mode/);
  });

  it('always needs the webhook secret', () => {
    expect(() => parse({ STRIPE_WEBHOOK_SECRET: '' })).toThrow(/STRIPE_WEBHOOK_SECRET/);
    expect(() => parse({ STRIPE_WEBHOOK_SECRET: 'not-a-secret' })).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });
});
