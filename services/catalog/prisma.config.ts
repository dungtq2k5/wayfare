// Prisma CLI configuration (architecture §3.3).
import 'dotenv/config'; // Prisma 7 no longer loads .env itself
import { defineConfig, env } from 'prisma/config';

const TARGETS = { working: 'DATABASE_URL', test: 'DATABASE_URL_TEST' } as const;
const db = process.env.PRISMA_DB ?? 'working';
// Object.hasOwn, not `in`: `in` accepts prototype keys, so PRISMA_DB=constructor would pass.
if (!Object.hasOwn(TARGETS, db)) {
  throw new Error(`Unknown PRISMA_DB "${db}" — expected working or test`);
}
const target = TARGETS[db as keyof typeof TARGETS];

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: env(target), // PRISMA_DB selects the database — never the shadow
    shadowDatabaseUrl: env('DATABASE_URL_SHADOW'), // used only by migrate diff / migrate dev
  },
});
