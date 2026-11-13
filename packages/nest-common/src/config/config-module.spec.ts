/* eslint-disable no-restricted-syntax -- this file exists to set, snapshot and restore process.env around the config module (conventions §13). */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildConfigService, snapshotProcessEnv } from '../testing/config';
import { createConfigModule, parseEnvOrThrow } from './config-module';
import { zPort } from './env-fields';

const schema = z
  .object({
    PORT: zPort,
    CORS_ORIGINS: z.string().transform((value) => value.split(',')),
    SWAGGER_ENABLED: z.enum(['true', 'false']).transform((value) => value === 'true'),
    OPTIONAL_NOTE: z.string().optional(),
    GREETING: z.string().default('hello'),
  })
  .refine((env) => env.PORT !== 1, { message: 'port 1 is reserved', path: ['PORT'] });
type Env = z.output<typeof schema>;

const valid = { PORT: '3000', CORS_ORIGINS: 'http://a,http://b', SWAGGER_ENABLED: 'true' };

@Injectable()
class Reader {
  // The constructor parameter is the generic class, never an alias (conventions §13).
  constructor(readonly config: ConfigService<Env, true>) {}
}

async function boot(options: Parameters<typeof createConfigModule>[2]) {
  @Module({ imports: [createConfigModule('probe', schema, options)], providers: [Reader] })
  class ProbeModule {}
  const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  return moduleRef.get(Reader).config;
}

let restoreEnv: () => void;
beforeEach(() => {
  restoreEnv = snapshotProcessEnv();
});
afterEach(() => restoreEnv());

describe('parseEnvOrThrow', () => {
  it('names the service and lists every issue, one per line', () => {
    expect(() => parseEnvOrThrow('probe', schema, { PORT: 'abc', SWAGGER_ENABLED: 'yes' })).toThrow(
      /^Invalid probe configuration:\n {2}PORT: .+\n {2}CORS_ORIGINS: .+\n {2}SWAGGER_ENABLED: .+$/,
    );
  });

  it('reports a refinement like any other issue', () => {
    expect(() => parseEnvOrThrow('probe', schema, { ...valid, PORT: '1' })).toThrow(
      /PORT: port 1 is reserved/,
    );
  });
});

describe('createConfigModule', () => {
  it('injects converted values into a ConfigService<Env, true> parameter', async () => {
    const config = await boot({ source: valid });
    expect(config).toBeInstanceOf(ConfigService);
    expect(config.get('PORT', { infer: true })).toBe(3000);
    expect(config.get('CORS_ORIGINS', { infer: true })).toEqual(['http://a', 'http://b']);
    expect(config.get('SWAGGER_ENABLED', { infer: true })).toBe(true);
    expect(config.get('GREETING', { infer: true })).toBe('hello');
  });

  it('never falls back to a raw process.env string for a key the schema leaves undefined', async () => {
    process.env.OPTIONAL_NOTE = 'from the environment';
    process.env.UNDECLARED = 'x';
    const config = await boot({ source: valid });
    expect(config.get('OPTIONAL_NOTE', { infer: true })).toBeUndefined();
    expect((config as unknown as ConfigService).get('UNDECLARED')).toBeUndefined();
  });

  it('with a source, ignores process.env and the .env file', async () => {
    process.env.PORT = '9999';
    const config = await boot({ source: valid });
    expect(config.get('PORT', { infer: true })).toBe(3000);
  });

  it('without a source, lets process.env override the .env file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wayfare-config-'));
    const envFilePath = join(dir, '.env');
    writeFileSync(envFilePath, 'PORT=4000\nCORS_ORIGINS=http://file\nSWAGGER_ENABLED=false\n');
    process.env.PORT = '5000';
    const config = await boot({ envFilePath });
    expect(config.get('PORT', { infer: true })).toBe(5000);
    expect(config.get('CORS_ORIGINS', { infer: true })).toEqual(['http://file']);
    expect(config.get('SWAGGER_ENABLED', { infer: true })).toBe(false);
  });

  it('stops the module from resolving on a bad value, with the readable message', async () => {
    await expect(boot({ source: { ...valid, PORT: 'abc' } })).rejects.toThrow(
      /Invalid probe configuration:\n {2}PORT:/,
    );
  });
});

describe('buildConfigService', () => {
  it('parses first, so a unit test never hands a service a raw value', () => {
    const config = buildConfigService('probe', schema, valid);
    expect(config.get('PORT', { infer: true })).toBe(3000);
    expect(() => buildConfigService('probe', schema, {})).toThrow(/Invalid probe configuration/);
  });
});
