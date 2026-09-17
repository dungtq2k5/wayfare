import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { parseEnvOrThrow } from '@wayfare/nest-common';
import { generateTestSigningKeys } from '@wayfare/nest-common/testing';
import { describe, expect, it } from 'vitest';
import { envSchema } from './env.schema';

const keys = generateTestSigningKeys('dev-1');

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://wayfare:wayfare@localhost:5433/wayfare_identity',
  NATS_URL: 'nats://localhost:4222',
  REDIS_URL: 'redis://localhost:6379',
  JWT_PRIVATE_KEY: keys.privateKey,
  JWT_KEY_ID: keys.keyId,
  GRPC_URL: '0.0.0.0:50051',
  OPS_PORT: '3101',
  METRICS_PORT: '9101',
  EMAIL_PROVIDER: 'smtp',
  EMAIL_FROM: 'Wayfare <no-reply@wayfare.local>',
  EMAIL_DELIVERY_MODE: 'restricted',
  EMAIL_NONPROD_ALLOWLIST: '*@example.com, Team@Wayfare.local',
  EMAIL_NONPROD_CATCHALL: 'team@wayfare.local',
  EMAIL_HASH_KEY: Buffer.alloc(32, 7).toString('base64'),
  SMTP_URL: 'smtp://localhost:1025',
  CONSOLE_URL: 'http://localhost:5173',
  WEB_URL: 'http://localhost:5174',
};

const parse = (env: Record<string, string>) => parseEnvOrThrow('identity', envSchema, env);

describe('identity configuration', () => {
  it('parses a complete environment into converted values', () => {
    const config = parse(valid);
    expect(config.OPS_PORT).toBe(3101);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.JWT_PRIVATE_KEY.asymmetricKeyType).toBe('ed25519');
  });

  it('refuses to boot without a signing key, or with a malformed key id, in every environment', () => {
    expect(() => parse({ ...valid, JWT_PRIVATE_KEY: '' })).toThrow(/JWT_PRIVATE_KEY/);
    expect(() => parse({ ...valid, NODE_ENV: 'test', JWT_PRIVATE_KEY: 'bm9wZQ==' })).toThrow(
      /JWT_PRIVATE_KEY/,
    );
    expect(() => parse({ ...valid, JWT_KEY_ID: 'Has Spaces' })).toThrow(/JWT_KEY_ID/);
  });

  it('refuses to boot with a missing or malformed variable, naming it', () => {
    const { DATABASE_URL: _omitted, ...rest } = valid;
    expect(() => parse(rest)).toThrow(/^Invalid identity configuration:\n {2}DATABASE_URL:/);
    expect(() => parse({ ...valid, NATS_URL: 'not a url' })).toThrow(/NATS_URL/);
  });
});

describe('email configuration', () => {
  it('parses the allowlist and the hash key', () => {
    const config = parse(valid);
    expect(config.EMAIL_NONPROD_ALLOWLIST).toEqual(['*@example.com', 'team@wayfare.local']);
    expect(config.EMAIL_HASH_KEY).toHaveLength(32);
    expect(config.RESEND_API_KEY).toBeUndefined();
  });

  it('requires a delivery mode, with no default', () => {
    const { EMAIL_DELIVERY_MODE: _omitted, ...rest } = valid;
    expect(() => parse(rest)).toThrow(/EMAIL_DELIVERY_MODE/);
  });

  it('requires the allowlist and catch-all when restricted, and not when open', () => {
    expect(() => parse({ ...valid, EMAIL_NONPROD_ALLOWLIST: '' })).toThrow(
      /EMAIL_NONPROD_ALLOWLIST: Required when EMAIL_DELIVERY_MODE=restricted/,
    );
    expect(() => parse({ ...valid, EMAIL_NONPROD_CATCHALL: '' })).toThrow(/EMAIL_NONPROD_CATCHALL/);
    expect(
      parse({ ...valid, EMAIL_DELIVERY_MODE: 'open', EMAIL_NONPROD_ALLOWLIST: '' })
        .EMAIL_DELIVERY_MODE,
    ).toBe('open');
    expect(() => parse({ ...valid, EMAIL_NONPROD_ALLOWLIST: 'not-an-entry' })).toThrow(
      /EMAIL_NONPROD_ALLOWLIST/,
    );
  });

  it("requires each provider's settings", () => {
    expect(() => parse({ ...valid, SMTP_URL: '' })).toThrow(/SMTP_URL: Required when/);
    expect(() => parse({ ...valid, EMAIL_PROVIDER: 'resend' })).toThrow(
      /RESEND_API_KEY[\s\S]*RESEND_WEBHOOK_SECRET/,
    );
    expect(
      parse({
        ...valid,
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_x',
        RESEND_WEBHOOK_SECRET: 'whsec_x',
      }).EMAIL_PROVIDER,
    ).toBe('resend');
    expect(() =>
      parse({
        ...valid,
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're',
        RESEND_WEBHOOK_SECRET: 'x',
      }),
    ).toThrow(/RESEND_WEBHOOK_SECRET/);
  });

  it('refuses a short hash key, a bare sender and a missing link base', () => {
    expect(() => parse({ ...valid, EMAIL_HASH_KEY: Buffer.alloc(8).toString('base64') })).toThrow(
      /EMAIL_HASH_KEY/,
    );
    expect(() => parse({ ...valid, EMAIL_FROM: 'no-reply@wayfare.local' })).toThrow(/EMAIL_FROM/);
    const { WEB_URL: _omitted, ...rest } = valid;
    expect(() => parse(rest)).toThrow(/WEB_URL/);
  });
});

describe('@nestjs/config', () => {
  it('resolves to one copy from identity and from nest-common — two copies would be two DI tokens', () => {
    const fromService = createRequire(__filename).resolve('@nestjs/config');
    const nestCommon = dirname(
      createRequire(__filename).resolve('@wayfare/nest-common/package.json'),
    );
    const fromNestCommon = createRequire(`${nestCommon}/package.json`).resolve('@nestjs/config');
    expect(fromNestCommon).toBe(fromService);
  });
});
