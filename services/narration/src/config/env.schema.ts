import { MAX_CONCURRENT_TTS_JOBS, trimTrailingSlashes } from '@wayfare/contracts';
import { isProductionEnv, zLogLevel, zNodeEnv, zPort } from '@wayfare/nest-common';
import type { TypedConfigService } from '@wayfare/nest-common';
import { z } from 'zod';

/** An optional variable; the empty value `.env.example` ships counts as unset. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

/** The translation providers narration can run (architecture §8). */
export const TRANSLATION_PROVIDER_NAMES = ['fake', 'google', 'free'] as const;
/** A translation provider's name. */
export type TranslationProviderName = (typeof TRANSLATION_PROVIDER_NAMES)[number];

/** The speech providers narration can run (architecture §8). */
export const SPEECH_PROVIDER_NAMES = ['fake', 'google', 'edge'] as const;
/** A speech provider's name. */
export type SpeechProviderName = (typeof SPEECH_PROVIDER_NAMES)[number];

/** A comma-separated provider order: known names, each once, at least one. */
const zOrder = <const N extends readonly [string, ...string[]]>(names: N) =>
  z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== ''),
    )
    .pipe(
      z
        .array(z.enum(names))
        .min(1)
        .refine((order) => new Set(order).size === order.length, 'Each provider once'),
    );

/** narration's environment, parsed once at boot (conventions §13). */
export const envSchema = z
  .object({
    NODE_ENV: zNodeEnv,
    LOG_LEVEL: zLogLevel,
    DATABASE_URL: z.url(),
    NATS_URL: z.url(),
    // BullMQ and the socket emitter — the same Redis as the gateway's adapter (conventions §7.4).
    REDIS_URL: z.url(),
    GRPC_URL: z.string().min(1),
    OPS_PORT: zPort,
    METRICS_PORT: zPort,
    CATALOG_GRPC_URL: z.string().min(1),
    // billing's gRPC address: a Venue's languages, for on-demand (api-endpoints-plan §12.2).
    BILLING_GRPC_URL: z.string().min(1),
    APP_VERSION: z.string().default('0.0.0-dev'),
    GIT_SHA: z.string().default('unknown'),
    BUILT_AT: z.string().default('unknown'),
    // Audio storage: the media bucket (architecture §3.6).
    GCS_BUCKET_MEDIA: z.string().min(3).max(222),
    GCS_API_ENDPOINT: optional(z.url()),
    GOOGLE_APPLICATION_CREDENTIALS: optional(z.string().min(1)),
    GCS_PUBLIC_BASE_URL: z.url().transform((value) => trimTrailingSlashes(value)),
    // Providers (conventions §11.5): a fallback is configuration, not an `if`.
    TRANSLATION_PROVIDER_ORDER: zOrder(TRANSLATION_PROVIDER_NAMES),
    TTS_PROVIDER_ORDER: zOrder(SPEECH_PROVIDER_NAMES),
    GOOGLE_CLOUD_PROJECT: optional(z.string().min(1)),
    SYNTHESIS_CONCURRENCY: optional(z.coerce.number().int().min(1).max(MAX_CONCURRENT_TTS_JOBS)),
    // Local and test only.
    FAKE_PROVIDER_FAILURES: optional(
      z
        .string()
        .transform((value) =>
          value
            .split(',')
            .map((kind) => kind.trim())
            .filter((kind) => kind !== ''),
        )
        .pipe(z.array(z.enum(['translation', 'speech']))),
    ),
  })
  .superRefine((env, ctx) => {
    const usesGoogle =
      env.TRANSLATION_PROVIDER_ORDER.includes('google') ||
      env.TTS_PROVIDER_ORDER.includes('google');
    if (usesGoogle && env.GOOGLE_CLOUD_PROJECT === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLOUD_PROJECT'],
        message: 'Required when a provider order names google',
      });
    }
    if (isProductionEnv(env.NODE_ENV)) {
      for (const key of ['TRANSLATION_PROVIDER_ORDER', 'TTS_PROVIDER_ORDER'] as const) {
        if ((env[key] as readonly string[]).includes('fake')) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'The fakes never run in production',
          });
        }
      }
      if (env.FAKE_PROVIDER_FAILURES !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['FAKE_PROVIDER_FAILURES'],
          message: 'Never set in production',
        });
      }
    }
  });

/** The validated environment. */
export type Env = z.output<typeof envSchema>;

/**
 * narration's configuration, as injected (conventions §13). For `app.get` and factory parameters
 * only: a constructor parameter is typed `ConfigService<Env, true>`, which SWC can emit as a DI token.
 */
export type NarrationConfig = TypedConfigService<Env>;
