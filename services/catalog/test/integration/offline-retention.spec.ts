// Retention of offline files (rdm-spec C-14): a retired map pack's objects go
// `MAP_PACK_RETENTION_DAYS` after it was retired, never a path a kept pack still names; old places
// snapshots go too, except each area and language's newest.
import { randomBytes } from 'node:crypto';
import { MAP_PACK_RETENTION_DAYS, newId } from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MapPacksPruneJob } from '../../src/modules/jobs/map-packs-prune.job';
import { OfflineSnapshotsPruneJob } from '../../src/modules/jobs/offline-snapshots-prune.job';
import { testPrisma, truncateAll } from '../setup/database';
import { taxonomy } from '../setup/fixtures';
import { catalogServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof catalogServices>;
let tax: Awaited<ReturnType<typeof taxonomy>>;
const DAY_MS = 24 * 60 * 60 * 1000;
const later = (days: number) => new Date(Date.now() + days * DAY_MS);

beforeEach(async () => {
  await truncateAll(prisma);
  services = catalogServices(prisma);
  tax = await taxonomy(prisma);
});
afterAll(() => prisma.$disconnect());

const put = (path: string) =>
  services.storage.upload(path, randomBytes(64), {
    contentType: 'application/octet-stream',
    cacheControl: 'no-store',
  });
const exists = async (path: string) => (await services.storage.stat(path)) !== null;

/** A pack whose three objects are uploaded; `shared` reuses another build's archive path. */
async function pack(version: number, status: string, retiredAt: Date | null, shared?: string) {
  const prefix = `maps/${tax.area.code}/${newId().replaceAll('-', '').slice(0, 16)}/`;
  const object = (name: string) => ({
    path: `${prefix}${name}`,
    sha256: 'a'.repeat(64),
    bytes: 64,
  });
  const pmtiles = shared ?? `${prefix}map.pmtiles`;
  for (const path of [pmtiles, `${prefix}style.json`, `${prefix}fonts/a/0-255.pbf`])
    await put(path);
  return prisma.mapPack.create({
    data: {
      id: newId(),
      areaId: tax.area.id,
      version,
      status,
      pmtilesObjectPath: pmtiles,
      pmtilesSha256: 'a'.repeat(64),
      pmtilesBytes: 64n,
      styleObjectPath: `${prefix}style.json`,
      assets: { style: object('style.json'), files: [object('fonts/a/0-255.pbf')] },
      source: 'test',
      sourceDate: new Date('2026-09-15T00:00:00.000Z'),
      minZoom: 10,
      maxZoom: 15,
      buildTool: 'test',
      createdById: newId(),
      retiredAt,
    },
  });
}

describe('map-packs-prune', () => {
  it('deletes a retired pack’s objects after the window, then stamps it; never a kept pack’s path', async () => {
    const old = await pack(1, 'RETIRED', new Date());
    const live = await pack(2, 'PUBLISHED', null, old.pmtilesObjectPath);
    const job = new MapPacksPruneJob(prisma, services.storage);

    expect(await job.run(later(MAP_PACK_RETENTION_DAYS - 1))).toEqual({ packs: 0, objects: 0 });
    expect(await job.run(later(MAP_PACK_RETENTION_DAYS + 1))).toEqual({ packs: 1, objects: 2 });

    const stamped = await prisma.mapPack.findUniqueOrThrow({ where: { id: old.id } });
    expect(stamped.objectsDeletedAt).not.toBeNull();
    expect(await exists(old.styleObjectPath)).toBe(false);
    // The archive both builds name stays, with the live pack.
    expect(await exists(old.pmtilesObjectPath)).toBe(true);
    expect(await exists(live.styleObjectPath)).toBe(true);
    expect(await job.run(later(MAP_PACK_RETENTION_DAYS + 2))).toEqual({ packs: 0, objects: 0 });
  });
});

describe('offline-snapshots-prune', () => {
  it('deletes old snapshots but each area and language’s newest', async () => {
    const folder = `offline/${tax.area.code}-${newId().slice(-6)}`;
    const oldest = `${folder}/en/10-3.ndjson.gz`;
    await put(oldest);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const newest = `${folder}/en/12-3.ndjson.gz`;
    await put(newest);
    const onlyVi = `${folder}/vi/10-3.ndjson.gz`;
    await put(onlyVi);
    const job = new OfflineSnapshotsPruneJob(services.storage);

    await job.run(later(MAP_PACK_RETENTION_DAYS - 1));
    expect(await exists(oldest)).toBe(true);
    await job.run(later(MAP_PACK_RETENTION_DAYS + 1));
    expect(await exists(oldest)).toBe(false);
    expect(await exists(newest)).toBe(true);
    expect(await exists(onlyVi)).toBe(true);
  });
});
