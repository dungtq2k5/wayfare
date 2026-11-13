import { zLogLevel, zNodeEnv, zPort } from '@wayfare/nest-common';
import type { TypedConfigService } from '@wayfare/nest-common';
import { z } from 'zod';

/** analytics' environment, parsed once at boot (conventions §13). */
export const envSchema = z.object({
  NODE_ENV: zNodeEnv,
  LOG_LEVEL: zLogLevel,
  DATABASE_URL: z.url(),
  // BullMQ (the rollup jobs) and the heatmap's and the runtime lane's counters.
  REDIS_URL: z.url(),
  GRPC_URL: z.string().min(1),
  // The scheduled jobs (the nightly rollup, the hourly flushes). Off only on the screens' stack,
  // whose numbers are the seed's: a job firing mid-run would move them under its baselines.
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  OPS_PORT: zPort,
  METRICS_PORT: zPort,
  APP_VERSION: z.string().default('0.0.0-dev'),
  GIT_SHA: z.string().default('unknown'),
  BUILT_AT: z.string().default('unknown'),
});

/** The validated environment. */
export type Env = z.output<typeof envSchema>;

/**
 * analytics' configuration, as injected (conventions §13). For `app.get` and factory parameters
 * only: a constructor parameter is typed `ConfigService<Env, true>`, which SWC can emit as a DI token.
 */
export type AnalyticsConfig = TypedConfigService<Env>;
