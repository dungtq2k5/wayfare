import {
  CategoryAppliesTo,
  newId,
  SYSTEM_CATEGORIES,
  TEST_CATEGORY_PREFIX,
} from '@wayfare/contracts';
import { FIXTURE_AREA_RING } from '@wayfare/contracts/testing';
import { buildConfigService } from '@wayfare/nest-common/testing';
import { envSchema } from '../../src/config/env.schema';
import type { CatalogConfig } from '../../src/config/env.schema';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { syncSystemCategories } from '../../src/modules/system-catalog/system-catalog.service';

/**
 * catalog's environment for tests: the values prepared by setup/env.ts, with the ports the suites
 * use. Passed to `AppModule.forRoot({ env })`, it is exactly what the app validates.
 */
export function testEnv(
  overrides: Record<string, string> = {},
): Record<string, string | undefined> {
  return {
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    GRPC_URL: '127.0.0.1:50152',
    OPS_PORT: '3192',
    METRICS_PORT: '9192',
    ...overrides,
  };
}

/** catalog's configuration for services built by hand in tests. */
export function testConfig(overrides: Record<string, string> = {}): CatalogConfig {
  return buildConfigService('catalog', envSchema, testEnv(overrides));
}

/** A PrismaService on the test database. */
export function testPrisma(): PrismaService {
  return new PrismaService(testConfig());
}

/**
 * Empties every catalog table between specs, except the seeded `categories` (conventions §17.2):
 * test-made (`TEST_`) categories are deleted, and every system row is put back as the registry has it.
 */
export async function truncateAll(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE places, areas, place_localizations, place_photos, menu_items, menu_item_localizations, pending_uploads, place_qr_scans_daily, place_opening_hours, orphaned_objects, owner_entitlements, outbox_events, processed_events, job_runs RESTART IDENTITY CASCADE',
  );
  const codes = SYSTEM_CATEGORIES.map((entry) => entry.code);
  await prisma.category.deleteMany({ where: { code: { notIn: codes } } });
  await syncSystemCategories(prisma);
  const rows = Prisma.join(
    SYSTEM_CATEGORIES.map(
      (entry) =>
        Prisma.sql`(${entry.code}, ${entry.appliesTo}, ${entry.icon}, ${entry.sortOrder}::smallint)`,
    ),
  );
  await prisma.$executeRaw`
    UPDATE categories c
    SET applies_to = v.applies_to, icon = v.icon, sort_order = v.sort_order, is_active = true
    FROM (VALUES ${rows}) AS v(code, applies_to, icon, sort_order)
    WHERE c.code = v.code`;
}

/** A seeded category's row, by code. */
export async function seededCategory(
  prisma: PrismaService,
  code: string,
): Promise<{ id: string; code: string }> {
  return prisma.category.findUniqueOrThrow({ where: { code }, select: { id: true, code: true } });
}

/** A `[lng, lat]` ring as WKT. */
const polygonWkt = (ring: readonly (readonly [number, number])[]) =>
  `POLYGON((${ring.map(([lng, lat]) => `${lng} ${lat}`).join(', ')}))`;

/** Inserts an area (tests insert them; pilot areas are seeded content). */
export async function insertArea(
  prisma: PrismaService,
  options: {
    code?: string;
    ring?: readonly (readonly [number, number])[];
    isActive?: boolean;
  } = {},
): Promise<{ id: string; code: string }> {
  const id = newId();
  const code = options.code ?? `area-${id.slice(-8)}`;
  const ring = options.ring ?? FIXTURE_AREA_RING;
  const [first] = ring;
  await prisma.$executeRaw`
    INSERT INTO areas (id, code, name_vi, boundary, center, default_zoom, is_active)
    VALUES (${id}::uuid, ${code}, ${`Khu ${code}`},
            ST_GeogFromText(${polygonWkt(ring)}),
            ST_SetSRID(ST_MakePoint(${first![0]}, ${first![1]}), 4326)::geography,
            15, ${options.isActive ?? true})`;
  return { id, code };
}

/** Inserts a test-made category; its code carries the `TEST_` prefix, so truncation removes it. */
export async function insertCategory(
  prisma: PrismaService,
  options: { code?: string; appliesTo?: CategoryAppliesTo; isActive?: boolean } = {},
): Promise<{ id: string; code: string }> {
  const code = options.code ?? `${TEST_CATEGORY_PREFIX}${newId().slice(-8).toUpperCase()}`;
  if (!code.startsWith(TEST_CATEGORY_PREFIX)) {
    throw new Error(
      `a test category's code starts with ${TEST_CATEGORY_PREFIX}: ${code} — use seededCategory for a system one`,
    );
  }
  return prisma.category.create({
    data: {
      code,
      appliesTo: options.appliesTo ?? CategoryAppliesTo.ANY,
      icon: 'pin',
      isActive: options.isActive ?? true,
    },
    select: { id: true, code: true },
  });
}
