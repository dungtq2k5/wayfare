import type { DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigService } from '@nestjs/config';
import type { z } from 'zod';

/** `ConfigService` typed for one service's schema (conventions §13). Never a constructor parameter's type. */
export type TypedConfigService<Env> = ConfigService<Env, true>;

/**
 * Parses `raw` with the service's schema, or throws `Invalid <service> configuration:` with one
 * `KEY: message` line per issue — the message operators see when a variable is missing or wrong.
 */
export function parseEnvOrThrow<S extends z.ZodObject>(
  service: string,
  schema: S,
  raw: Readonly<Record<string, unknown>>,
): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid ${service} configuration:\n  ${problems.join('\n  ')}`);
  }
  return result.data;
}

/** Options for `createConfigModule`. */
export interface ConfigModuleOptions {
  /** Tests: validate exactly this object — no `.env` file, no `process.env`. */
  readonly source?: Readonly<Record<string, string | undefined>>;
  /** Where the `.env` file is; `.env` in the working directory by default. Tests pass a temp path. */
  readonly envFilePath?: string;
}

/**
 * Loads and validates a service's environment once, at boot, through `@nestjs/config` (conventions
 * §13). The zod schema is the only validator; real environment variables beat `.env`.
 *
 * - `skipProcessEnv` always: `forRoot` already merges `process.env` into what the schema sees, so
 *   `get` never falls back to a raw, unconverted environment string.
 * - No `cache` (in this version it only caches `process.env` reads) and no `expandVariables`:
 *   `${VAR}` interpolation is deliberately off — a value is exactly what the file says.
 */
export function createConfigModule<S extends z.ZodObject>(
  service: string,
  schema: S,
  options: ConfigModuleOptions = {},
): Promise<DynamicModule> {
  const { source } = options;
  if (source !== undefined) {
    return ConfigModule.forRoot({
      isGlobal: true,
      skipProcessEnv: true,
      ignoreEnvFile: true,
      ignoreEnvVars: true,
      validate: () => parseEnvOrThrow(service, schema, source),
    });
  }
  return ConfigModule.forRoot({
    isGlobal: true,
    skipProcessEnv: true,
    envFilePath: options.envFilePath ?? '.env',
    validate: (raw) => parseEnvOrThrow(service, schema, raw),
  });
}
