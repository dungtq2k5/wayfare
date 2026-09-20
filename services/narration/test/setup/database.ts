import { buildConfigService } from '@wayfare/nest-common/testing';
import { envSchema } from '../../src/config/env.schema';
import type { NarrationConfig } from '../../src/config/env.schema';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

/**
 * narration's environment for tests: the values prepared by setup/env.ts, with the ports the
 * suites use. Passed to `AppModule.forRoot({ env })`, it is exactly what the app validates.
 */
export function testEnv(
  overrides: Record<string, string> = {},
): Record<string, string | undefined> {
  return {
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    GRPC_URL: '127.0.0.1:50153',
    OPS_PORT: '3193',
    METRICS_PORT: '9193',
    ...overrides,
  };
}

/** narration's configuration for services built by hand in tests. */
export function testConfig(overrides: Record<string, string> = {}): NarrationConfig {
  return buildConfigService('narration', envSchema, testEnv(overrides));
}

/** A PrismaService on the test database. */
export function testPrisma(): PrismaService {
  return new PrismaService(testConfig());
}

/** Empties every narration table between specs (conventions §17.2). */
export async function truncateAll(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE synthesis_jobs, synthesis_tasks, audio_assets, translation_cache, pronunciation_entries, localization_overrides, ui_bundles, outbox_events, processed_events, job_runs RESTART IDENTITY CASCADE',
  );
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
