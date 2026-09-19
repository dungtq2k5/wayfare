// pnpm --filter @wayfare/billing db:seed:system — inserts `FREE` into the database `PRISMA_DB`
// selects (working or test) when it is missing, as billing's boot does. Part of `pnpm db:deploy` in
// every environment; runs from the build output, so `db:setup` builds first.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { syncSystemPlans } from '../modules/system-plans/system-plans.service';

async function main(): Promise<void> {
  const url =
    process.env.PRISMA_DB === 'test' ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;
  if (!url) throw new Error('No database URL — copy .env.example to .env');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const inserted = await syncSystemPlans(prisma);
    console.log(
      `✓ system plans synced, FREE ${inserted ? 'inserted' : 'present'} (${process.env.PRISMA_DB ?? 'working'})`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
