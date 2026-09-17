/* eslint-disable no-restricted-syntax -- this file exists to set, snapshot and restore process.env around the config module (conventions §13). */
import { ConfigService } from '@nestjs/config';
import type { z } from 'zod';
import { parseEnvOrThrow } from '../config/config-module';
import type { TypedConfigService } from '../config/config-module';

/**
 * A `ConfigService` holding exactly the parsed `env`, for unit tests that construct a service by
 * hand. Parsed first, so a test can never hand a service an unconverted value.
 */
export function buildConfigService<S extends z.ZodObject>(
  service: string,
  schema: S,
  env: Readonly<Record<string, string | undefined>>,
): TypedConfigService<z.output<S>> {
  return new ConfigService<z.output<S>, true>(parseEnvOrThrow(service, schema, env));
}

/**
 * Snapshots `process.env` and returns the restore. `@nestjs/config` writes validated values back
 * into `process.env`, so every test that builds a config module restores it afterwards.
 */
export function snapshotProcessEnv(): () => void {
  const saved = { ...process.env };
  return () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  };
}
