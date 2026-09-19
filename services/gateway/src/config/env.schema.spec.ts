import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { parseEnvOrThrow } from '@wayfare/nest-common';
import { generateTestSigningKeys } from '@wayfare/nest-common/testing';
import { describe, expect, it } from 'vitest';
import { envSchema } from './env.schema';

const keys = generateTestSigningKeys('dev-1');

const valid = {
  NODE_ENV: 'development',
  PORT: '13000',
  GLOBAL_PREFIX: 'api',
  CORS_ORIGINS: 'http://localhost:5173, http://localhost:5174',
  TRUST_PROXY_HOPS: '0',
  SWAGGER_ENABLED: 'true',
  IDENTITY_GRPC_URL: 'localhost:20051',
  CATALOG_GRPC_URL: 'localhost:20052',
  NARRATION_GRPC_URL: 'localhost:20053',
  BILLING_GRPC_URL: 'localhost:20054',
  PUBLIC_QR_BASE_URL: 'https://go.wayfare.app/',
  PUBLIC_LINK_BASE_URL: 'https://wayfare.app',
  JWT_PUBLIC_KEYS: keys.publicKeys,
  REDIS_URL: 'redis://localhost:16379',
  METRICS_PORT: '9100',
};

const parse = (env: Record<string, string>) => parseEnvOrThrow('gateway', envSchema, env);

describe('gateway configuration', () => {
  it('parses a complete environment into converted values', () => {
    const config = parse(valid);
    expect(config.PORT).toBe(13000);
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:5174']);
    expect(config.SWAGGER_ENABLED).toBe(true);
    expect(config.JWT_PUBLIC_KEYS.get('dev-1')?.asymmetricKeyType).toBe('ed25519');
    expect(config.MIN_SUPPORTED_APP_VERSION).toBe('0.0.0');
    // No trailing slash: paths are appended.
    expect(config.PUBLIC_QR_BASE_URL).toBe('https://go.wayfare.app');
  });

  it('refuses a sticker host that is not http(s)', () => {
    expect(() => parse({ ...valid, PUBLIC_QR_BASE_URL: 'ftp://go.wayfare.app' })).toThrow(
      /PUBLIC_QR_BASE_URL/,
    );
  });

  it('refuses a malformed port, naming it on its own line', () => {
    expect(() => parse({ ...valid, PORT: 'abc' })).toThrow(
      /^Invalid gateway configuration:\n {2}PORT:/,
    );
  });

  it('refuses Swagger in production, and a wildcard origin', () => {
    expect(() => parse({ ...valid, NODE_ENV: 'production' })).toThrow(
      /SWAGGER_ENABLED: SWAGGER_ENABLED must be false in production/,
    );
    expect(() => parse({ ...valid, CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS/);
  });
});

describe('@nestjs/config', () => {
  it('resolves to one copy from the gateway and from nest-common — two copies would be two DI tokens', () => {
    const fromService = createRequire(__filename).resolve('@nestjs/config');
    const nestCommon = dirname(
      createRequire(__filename).resolve('@wayfare/nest-common/package.json'),
    );
    const fromNestCommon = createRequire(`${nestCommon}/package.json`).resolve('@nestjs/config');
    expect(fromNestCommon).toBe(fromService);
  });
});
