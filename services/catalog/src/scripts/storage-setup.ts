// pnpm --filter @wayfare/catalog storage:setup [-- --cors-origin <origin> …] — creates the media
// bucket with its CORS rule (architecture §3.6). Idempotent. Runs against the emulator locally and in
// the integration setup, and is the one-time step for a real bucket; there, the CDN serves only
// `photos/`. Without `--cors-origin`, the local console and web origins are allowed.
import { Storage } from '@google-cloud/storage';
import { config } from 'dotenv';

/** The local console and web origins (architecture §14's CORS_ORIGINS defaults). */
export const LOCAL_CORS_ORIGINS = ['http://localhost:5173', 'http://localhost:5174'];

/** The CORS rule a browser upload needs: a signed PUT with its two bound headers. */
export function mediaCorsRule(origins: readonly string[]) {
  return [
    {
      origin: [...origins],
      method: ['PUT'],
      responseHeader: ['Content-Type', 'x-goog-content-length-range'],
      maxAgeSeconds: 3600,
    },
  ];
}

/** Creates the bucket when missing, then sets its CORS rule. */
export async function setupStorage(input: {
  readonly bucket: string;
  readonly apiEndpoint?: string;
  readonly keyFilename?: string;
  readonly corsOrigins: readonly string[];
  readonly print: (line: string) => void;
}): Promise<void> {
  const storage = new Storage({
    ...(input.apiEndpoint === undefined ? {} : { apiEndpoint: input.apiEndpoint }),
    ...(input.keyFilename === undefined ? {} : { keyFilename: input.keyFilename }),
  });
  const bucket = storage.bucket(input.bucket);
  const [exists] = await bucket.exists();
  if (exists) input.print(`✓ bucket ${input.bucket} exists`);
  else {
    await storage.createBucket(input.bucket);
    input.print(`✓ bucket ${input.bucket} created`);
  }
  await bucket.setCorsConfiguration(mediaCorsRule(input.corsOrigins));
  input.print(`✓ CORS: PUT from ${input.corsOrigins.join(', ')}`);
}

/** `--cors-origin <origin>`, repeatable. */
export function corsOriginsFrom(argv: readonly string[]): string[] {
  const origins: string[] = [];
  argv.forEach((arg, index) => {
    if (arg === '--cors-origin' && argv[index + 1] !== undefined) origins.push(argv[index + 1]!);
  });
  return origins.length > 0 ? origins : LOCAL_CORS_ORIGINS;
}

if (require.main === module) {
  config({ quiet: true });
  const env = process.env;
  const bucket = env.GCS_BUCKET_MEDIA;
  if (!bucket) {
    console.error('✗ GCS_BUCKET_MEDIA is required');
    process.exit(1);
  }
  setupStorage({
    bucket,
    apiEndpoint: env.GCS_API_ENDPOINT || undefined,
    keyFilename: env.GOOGLE_APPLICATION_CREDENTIALS || undefined,
    corsOrigins: corsOriginsFrom(process.argv.slice(2)),
    print: (line) => console.log(line),
  }).catch((error: unknown) => {
    console.error(
      `✗ storage setup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
