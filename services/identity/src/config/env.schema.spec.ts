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
