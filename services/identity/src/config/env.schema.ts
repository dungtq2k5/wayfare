import { zKeyId, zLogLevel, zNodeEnv, zPort, zPrivateKeyEnv } from '@wayfare/nest-common';
import type { TypedConfigService } from '@wayfare/nest-common';
import { z } from 'zod';

/** identity's environment, parsed once at boot (conventions §13). */
export const envSchema = z.object({
  NODE_ENV: zNodeEnv,
  LOG_LEVEL: zLogLevel,
  DATABASE_URL: z.url(),
  NATS_URL: z.url(),
  // Revocation state for the gateway (api-endpoints-plan §0.1).
  REDIS_URL: z.url(),
  // The access-token signing key, required in every environment (ADR 0043); `pnpm keys:dev` locally.
  JWT_PRIVATE_KEY: zPrivateKeyEnv,
  JWT_KEY_ID: zKeyId,
  GRPC_URL: z.string().min(1),
  OPS_PORT: zPort,
  METRICS_PORT: zPort,
  // Build identity for /version, stamped into the image; defaults keep local runs working.
  APP_VERSION: z.string().default('0.0.0-dev'),
  GIT_SHA: z.string().default('unknown'),
  BUILT_AT: z.string().default('unknown'),
});

/** The validated environment. */
export type Env = z.output<typeof envSchema>;

/**
 * identity's configuration, as injected (conventions §13). For `app.get` and factory parameters only:
 * a constructor parameter is typed `ConfigService<Env, true>`, which SWC can emit as a DI token.
 */
export type IdentityConfig = TypedConfigService<Env>;
