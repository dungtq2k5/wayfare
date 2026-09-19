// The pilot seed through catalog's real write path (ADR 0002), on a two-Place slice of the corpus.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AUDIT_RECORD,
  CATALOG_PLACE_CONTENT_CHANGED,
  PlaceStatus,
  SynthesisTrigger,
} from '@wayfare/contracts';
import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assertNotProduction, SEED_EDITOR_CONTEXT } from '../../prisma/seed/pilot-d1.seed';
import { loadPilotCorpus } from '../../prisma/seed/pilot-corpus';
import type { PilotCorpus, PilotPlace } from '../../prisma/seed/pilot-corpus';
import { PilotSeeder } from '../../prisma/seed/pilot-seeder';
import { insertArea, testPrisma, truncateAll } from '../setup/database';
import { insertPlace } from '../setup/fixtures';
import { catalogServices } from '../setup/services';

const prisma = testPrisma();
const services = catalogServices(prisma);
const full = loadPilotCorpus();

beforeEach(() => truncateAll(prisma));
afterAll(async () => {
  await truncateAll(prisma);
  await prisma.$disconnect();
});

/** A corpus folder with the first two Places, the first carrying one generated photo. */
async function slice(
  edit: (places: PilotPlace[]) => PilotPlace[] = (places) => places,
): Promise<PilotCorpus> {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-slice-'));
  mkdirSync(join(dir, 'photos', full.places[0]!.slug), { recursive: true });
  const photo = await sharp({
    create: { width: 800, height: 600, channels: 3, background: '#b0703a' },
  })
    .jpeg()
    .toBuffer();
  writeFileSync(join(dir, 'photos', full.places[0]!.slug, '1.jpg'), photo);
  const places = [
    {
      ...full.places[0]!,
      photos: [{ file: `${full.places[0]!.slug}/1.jpg`, altTextVi: 'Mặt tiền' }],
    },
    full.places[1]!,
  ];
  writeFileSync(join(dir, 'area.json'), JSON.stringify(full.area));
  writeFileSync(join(dir, 'places.json'), JSON.stringify(edit(places)));
  return loadPilotCorpus(dir);
}

const seeder = () =>
  new PilotSeeder(
    { places: services.places, uploads: services.uploads, areas: services.areas, prisma },
    SEED_EDITOR_CONTEXT,
  );

const subjects = async () =>
  (
    await prisma.outboxEvent.findMany({
      orderBy: { id: 'asc' },
      select: { subject: true, payload: true },
    })
  ).map((row) => ({ subject: row.subject, payload: row.payload as Record<string, unknown> }));

const hoursEdit = (places: PilotPlace[]) =>
  places.map((place, index) =>
    index === 1
      ? {
          ...place,
          openingHours: [{ weekday: 1, opensAt: '08:00', closesAt: '17:00', isClosed: false }],
        }
      : place,
  );

describe('pilot-d1 seed', () => {
  it('creates both Places through CreateEditorialPlace, then writes nothing on a second run', async () => {
    const corpus = await slice();
    const report = await seeder().run(corpus);
    expect(report.stopped).toBeNull();
    expect(report.rows.map((row) => row.outcome)).toEqual(['created', 'created']);

    for (const place of corpus.places) {
      const row = await prisma.place.findUniqueOrThrow({ where: { id: place.id } });
      expect(row).toMatchObject({
        publicCode: place.publicCode,
        status: PlaceStatus.PROCESSING,
        createdById: SEED_EDITOR_CONTEXT.userId,
      });
    }
    const events = await subjects();
    const changed = events.filter(
      (event) => event.subject === CATALOG_PLACE_CONTENT_CHANGED.subject,
    );
    expect(changed.map((event) => event.payload.trigger)).toEqual([
      SynthesisTrigger.APPROVAL,
      SynthesisTrigger.APPROVAL,
    ]);
    const audits = events.filter((event) => event.subject === AUDIT_RECORD.subject);
    expect(audits.map((event) => event.payload.action)).toEqual([
      'AREA_CREATED',
      'PLACE_CREATED',
      'PLACE_CREATED',
    ]);
    expect(audits[0]!.payload.actor).toEqual({ type: 'USER', userId: SEED_EDITOR_CONTEXT.userId });

    const [photo] = await prisma.placePhoto.findMany({ where: { placeId: corpus.places[0]!.id } });
    expect(photo!.altTextVi).toBe('Mặt tiền');
    const variants = photo!.variants as { card: { objectPath: string } };
    expect(await services.storage.stat(variants.card.objectPath)).not.toBeNull();
    expect(await prisma.placeOpeningHours.count({ where: { placeId: corpus.places[0]!.id } })).toBe(
      corpus.places[0]!.openingHours.length,
    );

    const outbox = await prisma.outboxEvent.count();
    const versions = await prisma.place.findMany({
      select: { id: true, syncVersion: true },
      orderBy: { id: 'asc' },
    });
    const again = await seeder().run(corpus);
    expect(again.area).toBe(`${corpus.area.code}: unchanged`);
    expect(again.rows.map((row) => row.outcome)).toEqual(['unchanged', 'unchanged']);
    expect(await prisma.outboxEvent.count()).toBe(outbox);
    expect(
      await prisma.place.findMany({
        select: { id: true, syncVersion: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(versions);
  });

  it('writes only what changed, and leaves a deleted Place deleted', async () => {
    await seeder().run(await slice());
    const before = (await subjects()).length;
    const edited = await slice((places) =>
      hoursEdit(places).map((place, index) =>
        index === 0
          ? { ...place, descriptionVi: `${place.descriptionVi} Chợ mở cửa từ sáng sớm.` }
          : place,
      ),
    );
    const report = await seeder().run(edited);
    expect(report.rows).toEqual([
      { slug: edited.places[0]!.slug, outcome: 'updated', detail: 'descriptionVi' },
      { slug: edited.places[1]!.slug, outcome: 'updated', detail: 'openingHours' },
    ]);
    const after = (await subjects()).slice(before);
    const changed = after.filter(
      (event) => event.subject === CATALOG_PLACE_CONTENT_CHANGED.subject,
    );
    expect(changed).toHaveLength(1);
    expect(changed[0]!.payload).toMatchObject({
      placeId: edited.places[0]!.id,
      trigger: SynthesisTrigger.CONTENT_CHANGED,
    });
    expect(await prisma.placeOpeningHours.count({ where: { placeId: edited.places[1]!.id } })).toBe(
      1,
    );

    await prisma.place.update({
      where: { id: edited.places[1]!.id },
      data: { deletedAt: new Date() },
    });
    const deleted = await seeder().run(edited);
    expect(deleted.rows[1]).toEqual({
      slug: edited.places[1]!.slug,
      outcome: 'skipped',
      detail: 'deleted by an admin',
    });
  });

  it('skips a Place whose committed code is taken, drawing no other code', async () => {
    const corpus = await slice();
    const area = await insertArea(prisma, {
      code: 'elsewhere',
      ring: [
        [106.6, 10.6],
        [106.61, 10.6],
        [106.61, 10.61],
        [106.6, 10.61],
        [106.6, 10.6],
      ],
    });
    const category = await prisma.category.findUniqueOrThrow({ where: { code: 'LANDMARK' } });
    await insertPlace(prisma, {
      areaId: area.id,
      categoryId: category.id,
      location: { lat: 10.605, lng: 106.605 },
      publicCode: corpus.places[1]!.publicCode,
    });
    const report = await seeder().run(corpus);
    expect(report.rows[1]!.outcome).toBe('skipped');
    expect(report.rows[1]!.detail).toMatch(/^code taken by /);
    expect(await prisma.place.findUnique({ where: { id: corpus.places[1]!.id } })).toBeNull();
  });

  it('stops, naming it, when another active area overlaps the pilot area', async () => {
    await insertArea(prisma, {
      code: 'walk-x',
      ring: [
        [106.699, 10.775],
        [106.701, 10.775],
        [106.701, 10.777],
        [106.699, 10.777],
        [106.699, 10.775],
      ],
    });
    const report = await seeder().run(await slice());
    expect(report.stopped).toMatch(/walk-x overlap hcmc-d1-core/);
    expect(report.rows).toEqual([]);
    expect(await prisma.place.count()).toBe(0);
  });

  it('refuses production before anything boots', () => {
    expect(() => assertNotProduction({ NODE_ENV: 'production' })).toThrow(
      /refuses to run with NODE_ENV=production/,
    );
    expect(() => assertNotProduction({ NODE_ENV: 'development' })).not.toThrow();
  });
});
