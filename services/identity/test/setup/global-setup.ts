// Migrate once, apply schema objects, verify them, and sync the system catalogue before any suite
// runs, so a missing index fails a test before it fails a write (ADR 0034, ADR 0045).
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { PrismaClient } from '../../generated/prisma/client';
import { syncSystemCatalog } from '../../src/modules/system-catalog/system-catalog.service';

export default async function setup(): Promise<void> {
  const cwd = resolve(__dirname, '../..');
  const bin = (name: string) => resolve(cwd, 'node_modules/.bin', name);
  const env = { ...process.env, PRISMA_DB: 'test' };
  const run = (command: string, args: string[]) =>
    execFileSync(command, args, { cwd, env, stdio: 'pipe' });
  run(bin('prisma'), ['migrate', 'deploy']);
  run(bin('prisma'), ['db', 'execute', '--file', 'prisma/sql/schema-objects.sql']);
  run(bin('wayfare-db-verify'), []);

  config({ path: resolve(cwd, '.env'), quiet: true });
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL_TEST }),
  });
  try {
    await syncSystemCatalog(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
