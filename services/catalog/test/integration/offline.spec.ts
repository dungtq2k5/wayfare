// The offline pack (api-endpoints-plan §2.4, rdm-spec C-14): a manifest at delta sync's cap with a
// places snapshot stored once under the area's own last change, the published map pack and the
// media its records name; a cached second answer; and the diff, which is delta sync plus assets.
import { createHash, randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import {
  compareStrings,
  newId,
  PlaceStatus,
  zOfflineManifest,
  zOfflineManifestDiff,
  zPlaceSyncRecord,
} from '@wayfare/contracts';
import type { OfflineManifest, OfflineManifestDiff } from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { insertArea, testPrisma, truncateAll } from '../setup/database';
import { device, errorOf, insertLocalization, insertPlace, taxonomy } from '../setup/fixtures';
import { catalogServices } from '../setup/services';
import { bumpSyncVersion } from '../../src/modules/sync/sync.service';

const prisma = testPrisma();
let services: ReturnType<typeof catalogServices>;
let tax: Awaited<ReturnType<typeof taxonomy>>;

beforeEach(async () => {
  await truncateAll(prisma);
  services = catalogServices(prisma);
  tax = await taxonomy(prisma);
});
afterAll(() => prisma.$disconnect());

/** Every write older than the sync lag, so the cap reaches it. */
const settle = () =>
  prisma.$executeRaw`UPDATE places SET updated_at = updated_at - interval '10 seconds'`;

const manifest = async (lang = 'en', areaId = tax.area.id): Promise<OfflineManifest> =>
  zOfflineManifest.parse(
    JSON.parse((await services.offline.getManifest({ areaId, lang }, device())).manifestJson),
  );

const diff = async (
  fromDatasetVersion: number,
  fromMapPackVersion = 0,
): Promise<OfflineManifestDiff> =>
  zOfflineManifestDiff.parse(
    JSON.parse(
      (
        await services.offline.getManifestDiff(
          {
            areaId: tax.area.id,
            lang: 'en',
            fromDatasetVersion: String(fromDatasetVersion),
            fromMapPackVersion,
          },
          device(),
        )
      ).diffJson,
    ),
  );

/** A live Place with English text and audio, and a card photo. */
async function livePlace(name: string) {
  const place = await insertPlace(prisma, { areaId: tax.area.id, categoryId: tax.any.id, name });
  await insertLocalization(prisma, place.id, 'en', place.contentHash, { name: `${name} (en)` });
  const variant = (size: string) => ({
    objectPath: `photos/${place.id}/${size}.webp`,
    sha256: createHash('sha256').update(`${place.id}-${size}`).digest('hex'),
    bytes: 1200,
    width: 800,
    height: 600,
  });
  await prisma.placePhoto.create({
    data: {
      placeId: place.id,
      sortOrder: 0,
      variants: { thumb: variant('thumb'), card: variant('card'), full: variant('full') },
      originalSha256: 'f'.repeat(64),
      uploadedById: newId(),
    },
  });
  await prisma.$transaction((tx) => bumpSyncVersion(tx, place.id));
  return place;
}

/** A published pack of the fixture area: an archive, a style and one glyph file. */
async function publishedPack(version: number, objectsDeletedAt: Date | null = null) {
  const object = (name: string, bytes: number) => ({
    path: `maps/${tax.area.code}/${String(version).padStart(16, '0')}/${name}`,
    sha256: randomBytes(32).toString('hex'),
    bytes,
  });
  const pmtiles = object('map.pmtiles', 50_000);
  await prisma.mapPack.create({
    data: {
      id: newId(),
      areaId: tax.area.id,
      version,
      status: objectsDeletedAt === null ? 'PUBLISHED' : 'RETIRED',
      pmtilesObjectPath: pmtiles.path,
      pmtilesSha256: pmtiles.sha256,
      pmtilesBytes: BigInt(pmtiles.bytes),
      styleObjectPath: object('style.json', 0).path,
      assets: { style: object('style.json', 900), files: [object('fonts/a/0-255.pbf', 3_000)] },
      source: 'protomaps-20260915',
      sourceDate: new Date('2026-09-15T00:00:00.000Z'),
      minZoom: 10,
      maxZoom: 15,
      buildTool: 'pmtiles 1.28.0',
      createdById: newId(),
      objectsDeletedAt,
      ...(objectsDeletedAt === null
        ? { publishedAt: new Date() }
        : { retiredAt: objectsDeletedAt }),
    },
  });
}

describe('the offline manifest', () => {
  it('lists the snapshot at the cap, the card photos, the audio and the map, with their sizes', async () => {
    const a = await livePlace('Chợ A');
    const b = await livePlace('Chợ B');
    await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.any.id,
      status: PlaceStatus.INACTIVE,
    });
    await settle();
    await publishedPack(1);
    const first = await manifest();

    expect(first.datasetVersion).toBe(Number(await services.sync.cap()));
    expect(first.mapPack).toMatchObject({ version: 1, assets: [expect.objectContaining({})] });
    expect(first.mapPack!.pmtiles.url).toMatch(/\/maps\/.+\/map\.pmtiles$/);
    expect(first.photos.map((photo) => photo.path).sort(compareStrings)).toEqual(
      [a.id, b.id].map((id) => `photos/${id}/card.webp`).sort(compareStrings),
    );
    expect(first.audio.map((audio) => audio.placeId).sort(compareStrings)).toEqual(
      [a.id, b.id].sort(compareStrings),
    );
    expect(first.totalBytes).toBe(first.places.bytes + 2 * 1200 + 2 * 1000 + 50_000 + 900 + 3_000);

    // The snapshot: the two live Places, as `/sync/places` records, hashed as stored.
    const stored = await services.storage.download(first.places.path);
    expect(createHash('sha256').update(stored).digest('hex')).toBe(first.places.sha256);
    const lines = gunzipSync(stored).toString('utf8').trim().split('\n');
    const records = lines.map((line) => zPlaceSyncRecord.parse(JSON.parse(line)));
    expect(records.map((record) => record.id).sort(compareStrings)).toEqual(
      [a.id, b.id].sort(compareStrings),
    );
    expect(records[0]!.localization.lang).toBe('en');
    expect(first.places.path).toMatch(
      new RegExp(`^offline/${tax.area.code}/en/\\d+-2\\.ndjson\\.gz$`),
    );

    // Cached: the same answer, from the cache.
    expect(await manifest()).toEqual(first);
    expect(services.manifestCache.hits).toBe(1);
  });

  it('reuses the snapshot file when another area changes, and names a new one for its own change', async () => {
    const a = await livePlace('Chợ A');
    await settle();
    const first = await manifest();

    const elsewhere = await insertArea(prisma, {
      ring: [
        [106.73, 10.765],
        [106.74, 10.765],
        [106.74, 10.775],
        [106.73, 10.775],
        [106.73, 10.765],
      ],
    });
    await insertPlace(prisma, {
      areaId: elsewhere.id,
      categoryId: tax.any.id,
      location: { lat: 10.77, lng: 106.735 },
    });
    await settle();
    const second = await manifest();
    expect(second.datasetVersion).toBeGreaterThan(first.datasetVersion);
    expect(second.places).toEqual(first.places);

    await prisma.place.update({
      where: { id: a.id },
      data: { status: PlaceStatus.INACTIVE, inactiveReason: 'ADMIN' },
    });
    await prisma.$transaction((tx) => bumpSyncVersion(tx, a.id));
    await settle();
    const third = await manifest();
    expect(third.places.path).not.toBe(first.places.path);
    expect(third.photos).toEqual([]);
  });

  it('answers mapPack null without a published pack, and 404 for an inactive area', async () => {
    await livePlace('Chợ A');
    await settle();
    expect((await manifest()).mapPack).toBeNull();
    const idle = await insertArea(prisma, { code: 'idle-area', isActive: false });
    expect(await errorOf(manifest('en', idle.id))).toEqual({
      code: 'RESOURCE_NOT_FOUND',
      details: { resource: 'AREA' },
    });
  });
});

describe('the manifest diff', () => {
  it('lists the Places changed since, their media and removals, a new snapshot, and no unchanged map', async () => {
    const a = await livePlace('Chợ A');
    const b = await livePlace('Chợ B');
    await settle();
    await publishedPack(1);
    const base = await manifest();

    await prisma.place.update({ where: { id: a.id }, data: { descriptionVi: 'Mô tả mới.' } });
    await prisma.$transaction((tx) => bumpSyncVersion(tx, a.id));
    await prisma.place.update({ where: { id: b.id }, data: { deletedAt: new Date() } });
    await prisma.$transaction((tx) => bumpSyncVersion(tx, b.id));
    await settle();

    const changes = await diff(base.datasetVersion, 1);
    expect(changes).toMatchObject({
      fromDatasetVersion: base.datasetVersion,
      changedPlaceIds: [a.id],
      removedPlaceIds: [b.id],
      mapPack: null,
      drop: [],
    });
    expect(changes.datasetVersion).toBeGreaterThan(base.datasetVersion);
    expect(changes.photos.map((photo) => photo.path)).toEqual([`photos/${a.id}/card.webp`]);
    expect(changes.audio.map((audio) => audio.placeId)).toEqual([a.id]);
    expect(changes.places.path).not.toBe(base.places.path);
    expect(changes.totalBytes).toBe(changes.places.bytes + 1200 + 1000);
  });

  it('sends the new map and the old paths to drop, and 409 once the old objects are gone', async () => {
    await livePlace('Chợ A');
    await settle();
    await publishedPack(1, new Date('2026-08-01T00:00:00.000Z'));
    await publishedPack(2);
    const from = (await manifest()).datasetVersion;
    expect(await errorOf(diff(from, 1))).toEqual({ code: 'DIFF_UNAVAILABLE', details: undefined });

    await prisma.mapPack.updateMany({ where: { version: 1 }, data: { objectsDeletedAt: null } });
    const replaced = await diff(from, 1);
    expect(replaced.mapPack!.version).toBe(2);
    expect(replaced.drop).toHaveLength(3);
    expect(replaced.drop.every((path) => path.includes('/0000000000000001/'))).toBe(true);
    expect(replaced.changedPlaceIds).toEqual([]);

    expect((await diff(from, 0)).mapPack!.version).toBe(2);
    expect((await errorOf(diff(from + 1_000_000, 2))).code).toBe('VALIDATION_FAILED');
  });
});
