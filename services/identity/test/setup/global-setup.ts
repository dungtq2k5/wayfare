// Migrate once, apply schema objects, verify them, and sync the system catalogue before any suite
// runs, so a missing index fails a test before it fails a write (ADR 0034, ADR 0045).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { parse } from 'dotenv';
import { PrismaClient } from '../../generated/prisma/client';
import { syncSystemCatalog } from '../../src/modules/system-catalog/system-catalog.service';

export default async function setup(): Promise<void> {
  const cwd = resolve(__dirname, '../..');
  const bin = (name: string) => resolve(cwd, 'node_modules/.bin', name);
  // This service's own .env, never merged into process.env: every project's global setup shares
  // one process, and another service's URLs there would send these migrations to its database.
  const own = parse(readFileSync(resolve(cwd, '.env')));
  const env = { ...process.env, ...own, PRISMA_DB: 'test' };
  const run = (command: string, args: string[]) =>
    execFileSync(command, args, { cwd, env, stdio: 'pipe' });
  run(bin('prisma'), ['migrate', 'deploy']);
  run(bin('prisma'), ['db', 'execute', '--file', 'prisma/sql/schema-objects.sql']);
  run(bin('wayfare-db-verify'), []);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: own.DATABASE_URL_TEST }),
  });
  try {
    await syncSystemCatalog(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
