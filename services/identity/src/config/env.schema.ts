import { zLogLevel, zNodeEnv, zPort } from '@wayfare/nest-common';
import { z } from 'zod';

/** identity's environment, parsed once at boot (conventions §13). */
export const envSchema = z.object({
  NODE_ENV: zNodeEnv,
  LOG_LEVEL: zLogLevel,
  DATABASE_URL: z.url(),
  NATS_URL: z.url(),
  GRPC_URL: z.string().min(1),
  OPS_PORT: zPort,
  METRICS_PORT: zPort,
  // Build identity for /version, stamped into the image; defaults keep local runs working.
  APP_VERSION: z.string().default('0.0.0-dev'),
  GIT_SHA: z.string().default('unknown'),
  BUILT_AT: z.string().default('unknown'),
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
    throw new Error(`Invalid identity configuration:\n  ${problems.join('\n  ')}`);
  }
  return new AppConfig(result.data);
}
