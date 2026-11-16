// pnpm seed:load — a catalog big enough for the load test (`infra/load/`): 2,000 Editorial Places
// on a ~40 m grid inside District 1's area, each made as the pilot seeder makes its Places (the
// seed editor, `createEditorialPlace`, activation requested), so narration gives each its five
// languages and its audio. Then it waits until all are live and refreshes the planner's statistics.
// Run after `pnpm seed:dev` (the seed editor, the area, the categories). Never in production;
// additive and idempotent — a Place already made is left as it is; `docker compose down -v` and
// `pnpm seed:dev` start again.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { packageRoot } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { config } from 'dotenv';
import { AppModule } from '../../src/app.module';
import { PlacesService } from '../../src/modules/places/places.service';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { inside, metres } from './corpus-geo';
import { assertNotProduction, SEED_EDITOR_CONTEXT } from './pilot-d1.seed';
import { SAMPLE_MARK } from './pilot-d4.seed';

/** How many Places the load test's catalog holds. */
export const LOAD_PLACES = 2_000;

/** The grid's step, metres. */
export const LOAD_SPACING_M = 40;

/** The Editorial categories the grid takes in turn. */
const CATEGORIES = ['LANDMARK', 'MUSEUM', 'MARKET', 'PARK', 'CHURCH', 'VIEWPOINT'] as const;

/** How long the seed waits for narration to make every Place live. */
const ACTIVE_TIMEOUT_MS = 30 * 60_000;

/** A ring as GeoJSON stores it: `[lng, lat]` corners. */
type Ring = readonly [number, number][];

/**
 * `count` points on a square grid `spacingM` apart, inside `ring` and at least half a step from
 * its edge, row by row from the south-west corner. Throws if the ring can't hold them.
 */
export function loadGrid(
  ring: Ring,
  count: number,
  spacingM: number,
): { lat: number; lng: number }[] {
  const lngs = ring.map(([lng]) => lng);
  const lats = ring.map(([, lat]) => lat);
  const [west, east] = [Math.min(...lngs), Math.max(...lngs)];
  const [south, north] = [Math.min(...lats), Math.max(...lats)];
  const middle = (south + north) / 2;
  // Degrees per metre, at the ring's middle latitude.
  const latStep = spacingM / metres({ lat: south, lng: west }, { lat: south + 1, lng: west });
  const lngStep = spacingM / metres({ lat: middle, lng: west }, { lat: middle, lng: west + 1 });
  const points: { lat: number; lng: number }[] = [];
  for (let lat = south + latStep / 2; lat < north && points.length < count; lat += latStep) {
    for (let lng = west + lngStep / 2; lng < east && points.length < count; lng += lngStep) {
      const point = { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
      if (inside(point, ring)) points.push(point);
    }
  }
  if (points.length < count) {
    throw new Error(`the area holds ${points.length} points ${spacingM} m apart, not ${count}`);
  }
  return points;
}

/** The `index`th Place's fixed id, so a second run finds what the first made. */
export function loadPlaceId(index: number): string {
  return `01a0b3c0-0000-7000-8000-${index.toString(16).padStart(12, '0')}`;
}

interface LoadDeps {
  readonly places: Pick<PlacesService, 'createEditorialPlace'>;
  readonly prisma: Pick<PrismaService, 'place' | '$executeRawUnsafe'>;
}

/**
 * Makes the `count` Places not made yet, waits until all are live, then runs `ANALYZE places`.
 * Refuses production before touching anything.
 */
export async function seedLoad(
  env: Readonly<Record<string, string | undefined>>,
  deps: LoadDeps,
  ring: Ring,
  context: AccountContext,
  count = LOAD_PLACES,
  log: (line: string) => void = console.log,
): Promise<{ made: number; kept: number }> {
  assertNotProduction(env);
  const points = loadGrid(ring, count, LOAD_SPACING_M);
  const ids = points.map((_, index) => loadPlaceId(index));
  const existing = new Set(
    (await deps.prisma.place.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(
      (row) => row.id,
    ),
  );
  let made = 0;
  for (const [index, location] of points.entries()) {
    const id = ids[index]!;
    if (existing.has(id)) continue;
    await deps.places.createEditorialPlace(
      {
        content: {
          nameVi: `Điểm thử tải ${index + 1} (${SAMPLE_MARK})`,
          descriptionVi: `Một điểm dừng thử tải số ${index + 1} trong Quận 1, ${SAMPLE_MARK}.`,
          categoryCode: CATEGORIES[index % CATEGORIES.length]!,
          location,
        },
        triggerRadiusM: 30,
        narrationPriority: 50,
        photos: [],
        openingHours: [],
        requestActivation: true,
      },
      context,
      { id },
    );
    made += 1;
    if (made % 200 === 0) log(`… ${made} made`);
  }
  log(`✓ ${made} made, ${existing.size} already there`);

  const deadline = Date.now() + ACTIVE_TIMEOUT_MS;
  for (;;) {
    const live = await deps.prisma.place.count({ where: { id: { in: ids }, status: 'ACTIVE' } });
    if (live === ids.length) break;
    if (Date.now() > deadline) {
      throw new Error(`${live} of ${ids.length} load Places live after 30 minutes`);
    }
    log(`… ${live} of ${ids.length} live`);
    await new Promise((done) => setTimeout(done, 10_000));
  }
  await deps.prisma.$executeRawUnsafe('ANALYZE places');
  log(`✓ all ${ids.length} live; places analysed`);
  return { made, kept: existing.size };
}

/** District 1's boundary, as the pilot corpus defines the area. */
export function districtOneRing(): Ring {
  const area = JSON.parse(
    readFileSync(resolve(packageRoot(__dirname), 'prisma/seed/pilot-d1/area.json'), 'utf8'),
  ) as { boundary: { coordinates: [number, number][][] } };
  return area.boundary.coordinates[0]!;
}

async function main(): Promise<void> {
  assertNotProduction(process.env);
  config({ path: resolve(packageRoot(__dirname), '.env'), quiet: true });
  const app = await NestFactory.createApplicationContext(AppModule.forRoot({ jobs: false }), {
    logger: ['error', 'warn'],
  });
  try {
    await seedLoad(
      process.env,
      { places: app.get(PlacesService), prisma: app.get(PrismaService) },
      districtOneRing(),
      SEED_EDITOR_CONTEXT,
    );
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
