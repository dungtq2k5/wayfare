import { zLogLevel, zNodeEnv, zPort } from '@wayfare/nest-common';
import type { TypedConfigService } from '@wayfare/nest-common';
import { z } from 'zod';

/** An optional variable; the empty value `.env.example` ships counts as unset. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

/** catalog's environment, parsed once at boot (conventions §13). */
export const envSchema = z.object({
  NODE_ENV: zNodeEnv,
  LOG_LEVEL: zLogLevel,
  DATABASE_URL: z.url(),
  NATS_URL: z.url(),
  // BullMQ, for the cleanup jobs (conventions §7.3).
  REDIS_URL: z.url(),
  GRPC_URL: z.string().min(1),
  OPS_PORT: zPort,
  METRICS_PORT: zPort,
  // billing's gRPC address: voucher counts before a Venue delete (api-endpoints-plan §12.2).
  BILLING_GRPC_URL: z.string().min(1),
  IDENTITY_GRPC_URL: z.string().min(1),
  // Build identity for /version, stamped into the image; defaults keep local runs working.
  APP_VERSION: z.string().default('0.0.0-dev'),
  GIT_SHA: z.string().default('unknown'),
  BUILT_AT: z.string().default('unknown'),
  // Media storage (architecture §3.6).
  GCS_BUCKET_MEDIA: z.string().min(3).max(222),
  // Local only: the emulator's origin. Unset, the client talks to Google.
  GCS_API_ENDPOINT: optional(z.url()),
  // Local only: a throwaway signing key file. Unset in Cloud Run, where IAM signBlob signs.
  GOOGLE_APPLICATION_CREDENTIALS: optional(z.string().min(1)),
  // Where clients fetch media: the CDN in front of the bucket; the emulator locally.
  GCS_PUBLIC_BASE_URL: z.url().transform((value) => value.replace(/\/+$/, '')),
});

/** The validated environment. */
export type Env = z.output<typeof envSchema>;

/**
 * catalog's configuration, as injected (conventions §13). For `app.get` and factory parameters only:
 * a constructor parameter is typed `ConfigService<Env, true>`, which SWC can emit as a DI token.
 */
export type CatalogConfig = TypedConfigService<Env>;
