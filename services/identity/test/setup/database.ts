import { AppConfig, envSchema } from '../../src/config/env.schema';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

/** A PrismaService on the test database. */
export function testPrisma(): PrismaService {
  return new PrismaService(testConfig());
}

/** identity's configuration for tests, from the environment prepared by setup/env.ts. */
export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return new AppConfig(
    envSchema.parse({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      GRPC_URL: '127.0.0.1:50151',
      OPS_PORT: '3191',
      METRICS_PORT: '9191',
      ...process.env,
      ...overrides,
    }),
  );
}

/** Empties every identity table between specs (conventions §17.2). */
export async function truncateAll(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE devices, outbox_events, audit_logs RESTART IDENTITY CASCADE',
  );
}
