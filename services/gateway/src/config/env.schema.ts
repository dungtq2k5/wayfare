import { zLogLevel, zNodeEnv, zPort } from '@wayfare/nest-common';
import { z } from 'zod';

/** `MAJOR.MINOR.PATCH`, no pre-release or build suffix. */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** "true" / "false" only — never `Boolean(value)`, which reads "false" as true (conventions §5.2). */
const zBooleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

/** gateway's environment, parsed once at boot (conventions §13, architecture §14). */
export const envSchema = z
  .object({
    NODE_ENV: zNodeEnv,
    LOG_LEVEL: zLogLevel,
    PORT: zPort,
    GLOBAL_PREFIX: z.string().regex(/^[a-z][a-z0-9-]*$/),
    CORS_ORIGINS: z
      .string()
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(
        z.array(z.url()).refine((origins) => !origins.includes('*'), 'never * with credentials'),
      ),
    // Exact number of proxies in front of the gateway: too low records the proxy's IP,
    // too high lets a client forge X-Forwarded-For.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10),
    SWAGGER_ENABLED: zBooleanString,
    IDENTITY_GRPC_URL: z.string().min(1),
    REDIS_URL: z.url(),
    METRICS_PORT: zPort,
    // The oldest client build accepted; configuration, so the floor moves without a release.
    MIN_SUPPORTED_APP_VERSION: z.string().regex(SEMVER).default('0.0.0'),
    APP_VERSION: z.string().default('0.0.0-dev'),
    GIT_SHA: z.string().default('unknown'),
    BUILT_AT: z.string().default('unknown'),
  })
  .refine((env) => !(env.NODE_ENV === 'production' && env.SWAGGER_ENABLED), {
    message: 'SWAGGER_ENABLED must be false in production',
    path: ['SWAGGER_ENABLED'],
  });

/** The validated environment. */
export type Env = z.infer<typeof envSchema>;

/** Typed configuration, injected by class token. Read configuration only through this. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- fields come from Env
export class AppConfig {
  constructor(env: Env) {
    Object.assign(this, env);
  }

  get isProduction(): boolean {
    return this.NODE_ENV === 'production';
  }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging, @typescript-eslint/no-empty-object-type
export interface AppConfig extends Env {}

/** Parses the environment; a missing or malformed value stops the process before it listens. */
export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid gateway configuration:\n  ${problems.join('\n  ')}`);
  }
  return new AppConfig(result.data);
}
