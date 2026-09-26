import { trimTrailingSlashes } from '@wayfare/contracts';
import { zLogLevel, zNodeEnv, zPort } from '@wayfare/nest-common';
import type { TypedConfigService } from '@wayfare/nest-common';
import { z } from 'zod';

/** An optional variable; the empty value `.env.example` ships counts as unset. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

/** Which Stripe a deployment talks to (architecture §5): stated here, and agreeing with the key. */
export const STRIPE_MODES = ['test', 'live'] as const;
/** A Stripe mode. */
export type StripeMode = (typeof STRIPE_MODES)[number];

/** The key prefix each mode accepts: restricted keys only, never `sk_` (architecture §14). */
const KEY_PREFIX: Readonly<Record<StripeMode, string>> = { test: 'rk_test_', live: 'rk_live_' };

/** billing's environment, parsed once at boot (conventions §13). */
export const envSchema = z
  .object({
    NODE_ENV: zNodeEnv,
    LOG_LEVEL: zLogLevel,
    DATABASE_URL: z.url(),
    NATS_URL: z.url(),
    // BullMQ (the webhook queue) and the invoice cache.
    REDIS_URL: z.url(),
    GRPC_URL: z.string().min(1),
    OPS_PORT: zPort,
    METRICS_PORT: zPort,
    CATALOG_GRPC_URL: z.string().min(1),
    IDENTITY_GRPC_URL: z.string().min(1),
    // Checkout's success and cancel pages, the portal's return page.
    CONSOLE_URL: z.url().transform((value) => trimTrailingSlashes(value)),
    APP_VERSION: z.string().default('0.0.0-dev'),
    GIT_SHA: z.string().default('unknown'),
    BUILT_AT: z.string().default('unknown'),
    STRIPE_MODE: z.preprocess(
      (value) => (value === '' || value === undefined ? 'test' : value),
      z.enum(STRIPE_MODES),
    ),
    STRIPE_SECRET_KEY: optional(z.string().min(1)),
    STRIPE_WEBHOOK_SECRET: z
      .string()
      .min(1, 'Required — run `pnpm keys:dev` locally')
      .startsWith('whsec_'),
  })
  .superRefine((env, ctx) => {
    const key = env.STRIPE_SECRET_KEY;
    if (key === undefined) {
      // Without a key the service runs; the Stripe-backed owner routes answer 503. Never in live mode.
      if (env.STRIPE_MODE === 'live') {
        ctx.addIssue({
          code: 'custom',
          path: ['STRIPE_SECRET_KEY'],
          message: 'Required in live mode',
        });
      }
      return;
    }
    if (!key.startsWith(KEY_PREFIX[env.STRIPE_MODE])) {
      ctx.addIssue({
        code: 'custom',
        path: ['STRIPE_SECRET_KEY'],
        message: `STRIPE_MODE=${env.STRIPE_MODE} takes a ${KEY_PREFIX[env.STRIPE_MODE]}… restricted key (never sk_)`,
      });
    }
  });

/** The validated environment. */
export type Env = z.output<typeof envSchema>;

/**
 * billing's configuration, as injected (conventions §13). For `app.get` and factory parameters
 * only: a constructor parameter is typed `ConfigService<Env, true>`, which SWC can emit as a DI token.
 */
export type BillingConfig = TypedConfigService<Env>;
