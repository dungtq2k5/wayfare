import { zEmail } from '@wayfare/contracts';
import { zKeyId, zLogLevel, zNodeEnv, zPort, zPrivateKeyEnv } from '@wayfare/nest-common';
import type { TypedConfigService } from '@wayfare/nest-common';
import { z } from 'zod';

/** An optional variable; the empty value `.env.example` ships counts as unset. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

/** One restricted-delivery entry: an exact address, or `*@domain`. */
const zAllowlistEntry = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.union([z.email(), z.string().regex(/^\*@[a-z0-9.-]+\.[a-z]{2,}$/)]));

/** `EMAIL_HASH_KEY`: at least 32 random bytes, base64 — the `keyedHash` key for addresses. */
const zHashKey = z
  .string()
  .min(1, 'Required — run `pnpm keys:dev` locally')
  .transform((value, ctx) => {
    const key = Buffer.from(value, 'base64');
    if (key.length < 32) {
      ctx.addIssue({ code: 'custom', message: 'Must be at least 32 bytes, base64-encoded' });
      return z.NEVER;
    }
    return key;
  });

/** identity's environment, parsed once at boot (conventions §13). */
export const envSchema = z
  .object({
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
    // Transactional email (conventions §11.4).
    EMAIL_PROVIDER: z.enum(['resend', 'smtp']),
    EMAIL_FROM: z.string().regex(/^[^<>]+ <[^<>\s]+@[^<>\s]+>$/, 'Expected `Name <address>`'),
    // Required with no default: staging runs as production, so NODE_ENV cannot decide this.
    EMAIL_DELIVERY_MODE: z.enum(['restricted', 'open']),
    EMAIL_NONPROD_ALLOWLIST: optional(
      z
        .string()
        .transform((value) => value.split(',').filter((entry) => entry.trim() !== ''))
        .pipe(z.array(zAllowlistEntry).min(1)),
    ),
    EMAIL_NONPROD_CATCHALL: optional(zEmail),
    EMAIL_HASH_KEY: zHashKey,
    // A sending-only key; the tracking check runs as a deploy step with its own key.
    RESEND_API_KEY: optional(z.string().min(1)),
    RESEND_WEBHOOK_SECRET: optional(z.string().startsWith('whsec_')),
    SMTP_URL: optional(z.url({ protocol: /^smtps?$/ })),
    // Bases of emailed links: the console for staff and owners, the web app for everyone else.
    CONSOLE_URL: z.url(),
    WEB_URL: z.url(),
  })
  .superRefine((env, ctx) => {
    const require = (key: keyof typeof env, when: string) => {
      if (env[key] === undefined) {
        ctx.addIssue({ code: 'custom', path: [key], message: `Required when ${when}` });
      }
    };
    if (env.EMAIL_DELIVERY_MODE === 'restricted') {
      require('EMAIL_NONPROD_ALLOWLIST', 'EMAIL_DELIVERY_MODE=restricted');
      require('EMAIL_NONPROD_CATCHALL', 'EMAIL_DELIVERY_MODE=restricted');
    }
    if (env.EMAIL_PROVIDER === 'resend') {
      require('RESEND_API_KEY', 'EMAIL_PROVIDER=resend');
      require('RESEND_WEBHOOK_SECRET', 'EMAIL_PROVIDER=resend');
    }
    if (env.EMAIL_PROVIDER === 'smtp') require('SMTP_URL', 'EMAIL_PROVIDER=smtp');
  });

/** The validated environment. */
export type Env = z.output<typeof envSchema>;

/**
 * identity's configuration, as injected (conventions §13). For `app.get` and factory parameters only:
 * a constructor parameter is typed `ConfigService<Env, true>`, which SWC can emit as a DI token.
 */
export type IdentityConfig = TypedConfigService<Env>;
