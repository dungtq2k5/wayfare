import { buildConfigService } from '@wayfare/nest-common/testing';
import { envSchema } from '../../src/config/env.schema';
import type { IdentityConfig } from '../../src/config/env.schema';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

/**
 * identity's environment for tests: the values prepared by setup/env.ts, with the ports the suites
 * use. Passed to `AppModule.forRoot({ env })`, it is exactly what the app validates.
 */
export function testEnv(
  overrides: Record<string, string> = {},
): Record<string, string | undefined> {
  return {
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    GRPC_URL: '127.0.0.1:50151',
    OPS_PORT: '3191',
    METRICS_PORT: '9191',
    ...overrides,
  };
}

/** identity's configuration for services built by hand in tests. */
export function testConfig(overrides: Record<string, string> = {}): IdentityConfig {
  return buildConfigService('identity', envSchema, testEnv(overrides));
}

/** A PrismaService on the test database. */
export function testPrisma(): PrismaService {
  return new PrismaService(testConfig());
}

/** Empties every identity table between specs (conventions §17.2). */
export async function truncateAll(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    // The catalogue (roles, permissions, role_permissions) is synced once by global-setup and kept.
    'TRUNCATE users, user_roles, sessions, legal_acceptances, devices, outbox_events, audit_logs RESTART IDENTITY CASCADE',
  );
}
