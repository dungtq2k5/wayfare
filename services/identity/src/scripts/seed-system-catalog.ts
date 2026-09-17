// pnpm --filter @wayfare/identity db:seed:system — mirrors the permission catalogue and system
// roles into the database `PRISMA_DB` selects (working or test), as identity's boot does.
// Part of `pnpm db:setup`; runs from the build output, so `db:setup` builds first.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { syncSystemCatalog } from '../modules/system-catalog/system-catalog.service';

async function main(): Promise<void> {
  const url =
    process.env.PRISMA_DB === 'test' ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;
  if (!url) throw new Error('No database URL — copy .env.example to .env');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await syncSystemCatalog(prisma);
    console.log(`✓ system catalogue synced (${process.env.PRISMA_DB ?? 'working'})`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
