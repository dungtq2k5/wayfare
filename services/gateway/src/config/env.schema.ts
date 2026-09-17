import { zLogLevel, zNodeEnv, zPort, zPublicKeysEnv } from '@wayfare/nest-common';
import type { TypedConfigService } from '@wayfare/nest-common';
import { z } from 'zod';

/** `MAJOR.MINOR.PATCH`, no pre-release or build suffix. */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** "true" / "false" only — never `Boolean(value)`, which reads "false" as true (conventions §5.2). */
const zBooleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

/** An origin (and optional path) with no trailing slash. */
const zBaseUrl = z.url({ protocol: /^https?$/ }).transform((value) => value.replace(/\/+$/, ''));

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
    CATALOG_GRPC_URL: z.string().min(1),
    // The sticker host (api-endpoints-plan §2.1): printed on every QR, so it can never change.
    PUBLIC_QR_BASE_URL: zBaseUrl,
    // The universal-link host `/q/:code` redirects to.
    PUBLIC_LINK_BASE_URL: zBaseUrl,
    // Verification keys by kid; two entries during a rotation (ADR 0043). `pnpm keys:dev` locally.
    JWT_PUBLIC_KEYS: zPublicKeysEnv,
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
export type Env = z.output<typeof envSchema>;

/**
 * The gateway's configuration, as injected (conventions §13). For `app.get` and factory parameters
 * only: a constructor parameter is typed `ConfigService<Env, true>`, which SWC can emit as a DI token.
 */
export type GatewayConfig = TypedConfigService<Env>;
