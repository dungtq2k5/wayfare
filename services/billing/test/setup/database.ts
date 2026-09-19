import { FREE_PLAN_CODE, FREE_PLAN_GRANTS } from '@wayfare/contracts';
import { buildConfigService } from '@wayfare/nest-common/testing';
import { envSchema } from '../../src/config/env.schema';
import type { BillingConfig } from '../../src/config/env.schema';
import { grantColumns } from '../../src/modules/entitlements/domain/grants-write';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

/**
 * billing's environment for tests: the values prepared by setup/env.ts, with the ports the suites
 * use. Passed to `AppModule.forRoot({ env })`, it is exactly what the app validates.
 */
export function testEnv(
  overrides: Record<string, string> = {},
): Record<string, string | undefined> {
  return {
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    GRPC_URL: '127.0.0.1:50154',
    OPS_PORT: '3194',
    METRICS_PORT: '9194',
    ...overrides,
  };
}

/** billing's configuration for services built by hand in tests. */
export function testConfig(overrides: Record<string, string> = {}): BillingConfig {
  return buildConfigService('billing', envSchema, testEnv(overrides));
}

/** A PrismaService on the test database. */
export function testPrisma(): PrismaService {
  return new PrismaService(testConfig());
}

/**
 * Empties every billing table between specs (conventions §17.2), keeping `FREE` — a system row —
 * with its seeded grants restored, and removing every other plan.
 */
export async function truncateAll(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE billing_events, billing_accounts, plan_prices, outbox_events, processed_events, job_runs RESTART IDENTITY CASCADE',
  );
  await prisma.$executeRaw`DELETE FROM plans WHERE code <> 'FREE' OR deleted_at IS NOT NULL`;
  await prisma.plan.updateMany({
    where: { code: FREE_PLAN_CODE },
    data: { ...grantColumns(FREE_PLAN_GRANTS), isActive: true, stripeProductId: null },
  });
}

/** The outbox payloads for a subject, oldest first. */
export async function outboxPayloads(prisma: PrismaService, subject: string) {
  const rows = await prisma.outboxEvent.findMany({
    where: { subject },
    orderBy: { id: 'asc' },
    select: { payload: true },
  });
  return rows.map((row) => row.payload as Record<string, unknown>);
}
