// Deploy the test database and verify it, and create the test bucket, before any suite runs — so a
// missing index fails a test before it fails a write, and the boot check passes (ADR 0045).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { LOCAL_CORS_ORIGINS, setupStorage } from '../../src/scripts/storage-setup';

export default async function setup(): Promise<void> {
  const cwd = resolve(__dirname, '../..');
  const bin = (name: string) => resolve(cwd, 'node_modules/.bin', name);
  // This service's own .env, never merged into process.env: every project's global setup shares
  // one process, and another service's URLs there would send these migrations to its database.
  const own = parse(readFileSync(resolve(cwd, '.env')));
  const env = { ...process.env, ...own, PRISMA_DB: 'test' };
  const run = (command: string, args: string[]) =>
    execFileSync(command, args, { cwd, env, stdio: 'pipe' });
  // `db:deploy` without the seed: catalog has no system rows.
  run(bin('prisma'), ['migrate', 'deploy']);
  run(bin('prisma'), ['db', 'execute', '--file', 'prisma/sql/schema-objects.sql']);
  run(bin('wayfare-db-verify'), []);

  await setupStorage({
    bucket: 'wayfare-media-test',
    apiEndpoint: own.GCS_API_ENDPOINT || 'http://localhost:4443',
    keyFilename: own.GOOGLE_APPLICATION_CREDENTIALS || undefined,
    corsOrigins: LOCAL_CORS_ORIGINS,
    print: () => undefined,
  });
}
