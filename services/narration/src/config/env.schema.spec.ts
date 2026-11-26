import { describe, expect, it } from 'vitest';
import { envSchema } from './env.schema';

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://wayfare:wayfare@localhost:15435/wayfare_narration',
  NATS_URL: 'nats://localhost:14222',
  REDIS_URL: 'redis://localhost:16379',
  GRPC_URL: '0.0.0.0:20053',
  OPS_PORT: '3103',
  METRICS_PORT: '9103',
  CATALOG_GRPC_URL: 'localhost:20052',
  BILLING_GRPC_URL: 'localhost:20054',
  GCS_BUCKET_MEDIA: 'wayfare-media',
  GCS_PUBLIC_BASE_URL: 'http://localhost:4443/wayfare-media/',
  TRANSLATION_PROVIDER_ORDER: 'fake',
  TTS_PROVIDER_ORDER: 'fake',
};

const parse = (over: Record<string, string>) => envSchema.parse({ ...valid, ...over });

describe('narration env schema', () => {
  it('reads a provider order as names, each once, and an empty optional as unset', () => {
    const env = parse({ TTS_PROVIDER_ORDER: ' edge, fake ', GCS_API_ENDPOINT: '' });
    expect(env.TTS_PROVIDER_ORDER).toEqual(['edge', 'fake']);
    expect(env.GCS_API_ENDPOINT).toBeUndefined();
    expect(env.GCS_PUBLIC_BASE_URL).toBe('http://localhost:4443/wayfare-media');
    expect(() => parse({ TTS_PROVIDER_ORDER: 'fake,fake' })).toThrow(/Each provider once/);
    expect(() => parse({ TTS_PROVIDER_ORDER: 'polly' })).toThrow();
  });

  it('reads the fakes’ failures, and refuses a kind it doesn’t know', () => {
    expect(
      parse({ FAKE_PROVIDER_FAILURES: 'speech, translation-unreachable,' }).FAKE_PROVIDER_FAILURES,
    ).toEqual(['speech', 'translation-unreachable']);
    expect(() => parse({ FAKE_PROVIDER_FAILURES: 'storage' })).toThrow();
  });

  it('needs a Google project when an order names google', () => {
    expect(() => parse({ TRANSLATION_PROVIDER_ORDER: 'google' })).toThrow(/GOOGLE_CLOUD_PROJECT/);
    expect(
      parse({ TTS_PROVIDER_ORDER: 'google', GOOGLE_CLOUD_PROJECT: 'wayfare' }).GOOGLE_CLOUD_PROJECT,
    ).toBe('wayfare');
  });

  it('never runs a fake, or a fake’s failures, in production', () => {
    const production = { NODE_ENV: 'production', GOOGLE_CLOUD_PROJECT: 'wayfare' };
    expect(() => parse({ ...production, TTS_PROVIDER_ORDER: 'google,fake' })).toThrow(
      /The fakes never run in production/,
    );
    expect(() =>
      parse({
        ...production,
        TRANSLATION_PROVIDER_ORDER: 'google',
        TTS_PROVIDER_ORDER: 'google',
        FAKE_PROVIDER_FAILURES: 'speech',
      }),
    ).toThrow(/Never set in production/);
    expect(
      parse({
        ...production,
        TRANSLATION_PROVIDER_ORDER: 'google,free',
        TTS_PROVIDER_ORDER: 'google,edge',
      }).NODE_ENV,
    ).toBe('production');
  });
});
