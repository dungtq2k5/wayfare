import { businessDay, newId, PlaceKind, PlaceStatus, SYSTEM_CATEGORIES } from '@wayfare/contracts';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { FIXTURE_INSIDE } from '@wayfare/contracts/testing';
import { buildAnonymousContext } from '@wayfare/nest-common/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NEARBY_CANDIDATE_CAP } from '../../src/modules/place-queries/place-queries.service';
import {
  insertArea,
  insertCategory,
  seededCategory,
  testPrisma,
  truncateAll,
} from '../setup/database';
import {
  confirmedUpload,
  createRequest,
  device,
  errorOf,
  insertLocalization,
  insertPlace,
  staff,
  taxonomy,
} from '../setup/fixtures';
import { catalogServices } from '../setup/services';

const prisma = testPrisma();
const { queries, places } = catalogServices(prisma);
const TIER = catalogGrpc.ContentTier;
let tax: Awaited<ReturnType<typeof taxonomy>>;

beforeEach(async () => {
  await truncateAll(prisma);
  tax = await taxonomy(prisma);
});
afterAll(() => prisma.$disconnect());

/** Ages every row past the sync lag, as five seconds of waiting would. */
const settle = () =>
  prisma.$executeRaw`UPDATE places SET updated_at = updated_at - interval '10 seconds'`;

/** A point `metres` east of the fixture point. */
const east = (metres: number) => ({
  lat: FIXTURE_INSIDE.lat,
  lng: FIXTURE_INSIDE.lng + metres / (111_320 * Math.cos((FIXTURE_INSIDE.lat * Math.PI) / 180)),
});

const live = (
  overrides: Parameters<typeof insertPlace>[1] extends infer T ? Partial<T> : never = {},
) => insertPlace(prisma, { areaId: tax.area.id, categoryId: tax.any.id, ...overrides });

describe('NearbyPlaces', () => {
  const nearby = (overrides: Partial<catalogGrpc.NearbyPlacesRequest> = {}) =>
    queries.nearbyPlaces(
      { ...FIXTURE_INSIDE, radiusM: 500, lang: 'en', limit: 20, ...overrides },
      device(),
    );

  it('ranks by distance, lets a boost move a Place ahead, and flags exactly that', async () => {
    const near = await live({ location: east(100), name: 'near' });
    const boosted = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.venueOnly.id,
      kind: PlaceKind.VENUE,
      location: east(150),
      discoveryBoost: 100,
      name: 'boosted',
    });
    const far = await live({ location: east(400), name: 'far' });
    // Outside the radius: never pulled in, however boosted.
    await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.venueOnly.id,
      kind: PlaceKind.VENUE,
      location: east(700),
      discoveryBoost: 100,
    });
    const result = await nearby();
    expect(result.places.map((item) => [item.id, item.sponsored])).toEqual([
      [boosted.id, true],
      [near.id, false],
      [far.id, false],
    ]);
    const [first] = result.places;
    expect(first!.distanceM).toBeGreaterThanOrEqual(149);
    expect(first!.distanceM).toBeLessThanOrEqual(151);
    expect(first!.walkingEtaMinutes).toBe(Math.ceil((first!.distanceM * 1.3) / 1.25 / 60));
    expect(first).toMatchObject({
      name: 'boosted',
      contentTier: TIER.CONTENT_TIER_SOURCE,
      lang: 'vi',
    });
    expect(NEARBY_CANDIDATE_CAP).toBe(200);
  });

  it('serves only live Places, filters by category, and applies the limit', async () => {
    const kept = await live({ location: east(50) });
    await live({ location: east(60), status: PlaceStatus.PROCESSING });
    await live({ location: east(70), deleted: true });
    const other = await seededCategory(prisma, 'TEMPLE');
    const temple = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: other.id,
      location: east(80),
    });
    expect((await nearby()).places.map((item) => item.id)).toEqual([kept.id, temple.id]);
    expect((await nearby({ categoryCode: 'TEMPLE' })).places.map((item) => item.id)).toEqual([
      temple.id,
    ]);
    expect((await nearby({ limit: 1 })).places).toHaveLength(1);
  });

  it('refuses a radius over 5 km, a limit over 50, and a caller without a device', async () => {
    expect((await errorOf(nearby({ radiusM: 5001 }))).code).toBe('VALIDATION_FAILED');
    expect((await errorOf(nearby({ limit: 51 }))).code).toBe('VALIDATION_FAILED');
    expect(
      (
        await errorOf(
          queries.nearbyPlaces({ ...FIXTURE_INSIDE, radiusM: 1, lang: 'en', limit: 1 }, staff()),
        )
      ).code,
    ).toBe('UNAUTHENTICATED');
  });
});

describe('GetPlace, GetPlaceByCode, ResolvePublicCode', () => {
  it('serves the detail in the requested language with its tier and audio', async () => {
    const actor = staff();
    const upload = await confirmedUpload(prisma, actor.userId);
    const { place } = await places.createEditorialPlace(
      createRequest({
        requestActivation: true,
        photos: [{ uploadId: upload.id, altTextVi: 'Cổng' }],
      }),
      actor,
    );
    await insertLocalization(prisma, place!.id, 'en', place!.contentHash, { name: 'Market' });
    await places.requestActivation({ placeId: place!.id }, actor);

    const { place: detail } = await queries.getPlace(
      { placeId: place!.id, lang: 'ja-JP' },
      device(),
    );
    expect(detail).toMatchObject({
      id: place!.id,
      publicCode: place!.publicCode,
      localization: {
        lang: 'en',
        name: 'Market',
        contentTier: TIER.CONTENT_TIER_ENGLISH,
        stale: false,
        audio: { url: expect.stringMatching(/\/audio\/.*-en\.mp3$/) as string, bytes: 1000 },
      },
      photos: [{ altText: 'Cổng' }],
      menu: undefined,
    });
    expect(detail!.syncVersion).toMatch(/^\d+$/);

    const { place: byCode } = await queries.getPlaceByCode(
      { publicCode: place!.publicCode.toLowerCase(), lang: 'en' },
      device(),
    );
    expect(byCode!.localization!.contentTier).toBe(TIER.CONTENT_TIER_REQUESTED);

    // Audio made for another text is never served beside this one.
    await prisma.placeLocalization.update({
      where: { placeId_lang: { placeId: place!.id, lang: 'en' } },
      data: { audioSourceContentHash: 'f'.repeat(64) },
    });
    const { place: silent } = await queries.getPlace({ placeId: place!.id, lang: 'en' }, device());
    expect(silent!.localization!.audio).toBeUndefined();
  });

  it('serves a Venue menu in the requested language', async () => {
    const venue = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.venueOnly.id,
      kind: PlaceKind.VENUE,
    });
    const item = await prisma.menuItem.create({
      data: {
        placeId: venue.id,
        nameVi: 'Phở',
        contentHash: 'a'.repeat(64),
        sortOrder: 0,
        priceMinor: 50_000,
      },
    });
    await prisma.menuItemLocalization.create({
      data: {
        menuItemId: item.id,
        lang: 'en',
        name: 'Pho',
        sourceContentHash: 'a'.repeat(64),
        translationSource: 'MACHINE',
      },
    });
    const { place } = await queries.getPlace({ placeId: venue.id, lang: 'en' }, device());
    expect(place!.menu).toEqual({
      menuCurrency: catalogGrpc.MenuCurrency.MENU_CURRENCY_VND,
      items: [
        {
          id: item.id,
          name: 'Pho',
          priceMinor: 50_000,
          isAvailable: true,
          contentTier: TIER.CONTENT_TIER_REQUESTED,
          stale: false,
        },
      ],
    });
  });

  it('hides what is not live: not found by id, unavailable by code', async () => {
    const hidden = await live({ status: PlaceStatus.INACTIVE });
    const deleted = await live({ deleted: true });
    for (const place of [hidden, deleted]) {
      expect(await errorOf(queries.getPlace({ placeId: place.id, lang: 'en' }, device()))).toEqual({
        code: 'RESOURCE_NOT_FOUND',
        details: { resource: 'PLACE' },
      });
      expect(
        (
          await errorOf(
            queries.getPlaceByCode({ publicCode: place.publicCode, lang: 'en' }, device()),
          )
        ).code,
      ).toBe('PLACE_UNAVAILABLE');
    }
    expect(
      (await errorOf(queries.getPlaceByCode({ publicCode: 'ZZZZZZZZ', lang: 'en' }, device())))
        .code,
    ).toBe('RESOURCE_NOT_FOUND');
    expect(
      (await errorOf(queries.getPlaceByCode({ publicCode: 'not a code', lang: 'en' }, device())))
        .code,
    ).toBe('VALIDATION_FAILED');
  });

  it('counts a scan for any Place with the code, live or not, per business day', async () => {
    const place = await live({ status: PlaceStatus.INACTIVE });
    const anonymous = buildAnonymousContext();
    expect(await queries.resolvePublicCode({ publicCode: place.publicCode }, anonymous)).toEqual({
      exists: true,
    });
    await queries.resolvePublicCode({ publicCode: place.publicCode.toLowerCase() }, anonymous);
    expect(await queries.resolvePublicCode({ publicCode: 'ZZZZZZZZ' }, anonymous)).toEqual({
      exists: false,
    });
    expect(await queries.resolvePublicCode({ publicCode: '<script>' }, anonymous)).toEqual({
      exists: false,
    });
    const scans = await prisma.placeQrScanDaily.findMany();
    expect(scans).toEqual([
      { placeId: place.id, day: new Date(`${businessDay(new Date())}T00:00:00Z`), scans: 2 },
    ]);
  });
});

describe('ListCategories and ListAreas', () => {
  it('lists active categories in order', async () => {
    await insertCategory(prisma, { code: 'TEST_HIDDEN', isActive: false });
    await prisma.category.update({ where: { code: 'CAFE' }, data: { isActive: false } });
    const { categories } = await queries.listCategories({}, buildAnonymousContext());
    expect(categories.map((category) => category.code)).toEqual(
      SYSTEM_CATEGORIES.map((entry) => entry.code).filter((code) => code !== 'CAFE'),
    );
    expect(categories.find((category) => category.code === 'RESTAURANT')!.appliesTo).toBe(
      catalogGrpc.CategoryAppliesTo.CATEGORY_APPLIES_TO_VENUE,
    );
  });

  it('lists active areas with GeoJSON and the shared dataset version', async () => {
    await insertArea(prisma, { isActive: false });
    const place = await live();
    await settle();
    const { areas } = await queries.listAreas({}, buildAnonymousContext());
    expect(areas).toHaveLength(1);
    expect(JSON.parse(areas[0]!.boundaryGeojson)).toMatchObject({ type: 'Polygon' });
    expect(areas[0]!.center).toEqual({ lat: 10.765, lng: 106.69 });
    const row = await prisma.place.findUniqueOrThrow({ where: { id: place.id } });
    expect(areas[0]!.datasetVersion).toBe(row.syncVersion.toString());
  });
});

describe('SyncPlaces', () => {
  const sync = (since: string, overrides: Partial<catalogGrpc.SyncPlacesRequest> = {}) =>
    queries.syncPlaces({ areaId: tax.area.id, lang: 'en', since, ...overrides }, device());

  it('serves nothing unsettled, then the live set; a first sync lists no removals', async () => {
    const shown = await live();
    await live({ status: PlaceStatus.PROCESSING });
    const empty = await sync('');
    expect(empty).toEqual({ places: [], removedPlaceIds: [], datasetVersion: '0', complete: true });
    await settle();
    const first = await sync('0');
    expect(first.places.map((place) => place.id)).toEqual([shown.id]);
    expect(first.removedPlaceIds).toEqual([]);
    expect(first.complete).toBe(true);
    expect(first.places[0]).toMatchObject({
      triggerRadiusM: 30,
      narrationPriority: 50,
      autoNarrationEnabled: true,
      localization: { contentTier: TIER.CONTENT_TIER_SOURCE },
    });
    expect(first.places[0]).not.toHaveProperty('discoveryBoost');
    // Nothing new: the same version comes back, never a lower one.
    expect(await sync(first.datasetVersion)).toEqual({ ...first, places: [] });
  });

  it('lists a deleted, hidden or moved Place as removed', async () => {
    const other = await insertArea(prisma, {
      code: 'other',
      ring: [
        [106.72, 10.765],
        [106.74, 10.765],
        [106.74, 10.78],
        [106.72, 10.78],
        [106.72, 10.765],
      ],
    });
    const stays = await live();
    const deleted = await live();
    const moved = await live();
    await settle();
    const base = await sync('0');
    await prisma.$executeRaw`UPDATE places SET deleted_at = now(), sync_version = nextval('catalog_sync_version_seq') WHERE id = ${deleted.id}::uuid`;
    await prisma.$executeRaw`UPDATE places SET area_id = ${other.id}::uuid, sync_version = nextval('catalog_sync_version_seq') WHERE id = ${moved.id}::uuid`;
    await prisma.$executeRaw`UPDATE places SET sync_version = nextval('catalog_sync_version_seq') WHERE id = ${stays.id}::uuid`;
    await settle();
    const delta = await sync(base.datasetVersion);
    expect(delta.places.map((place) => place.id)).toEqual([stays.id]);
    expect(delta.removedPlaceIds).toEqual([deleted.id, moved.id]);
    const there = await sync(base.datasetVersion, { areaId: other.id });
    expect(there.places.map((place) => place.id)).toEqual([moved.id]);
    expect(there.removedPlaceIds).toEqual([deleted.id, stays.id]);
  });

  it('pages a large change set by version', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 5; index++) ids.push((await live()).id);
    await settle();
    const { sync: service } = catalogServices(prisma);
    const page = await service.changes({ areaId: tax.area.id, since: 0n, pageSize: 2 });
    expect(page.complete).toBe(false);
    expect(page.changes.map((change) => change.id)).toEqual(ids.slice(0, 2));
    expect(page.datasetVersion).toBe(page.changes[1]!.syncVersion);
    const rest = await service.changes({
      areaId: tax.area.id,
      since: page.datasetVersion,
      pageSize: 3,
    });
    expect(rest.complete).toBe(true);
    expect(rest.changes.map((change) => change.id)).toEqual(ids.slice(2));
  });

  it('refuses an unknown or inactive area, a bad version, and a caller without a device', async () => {
    expect((await errorOf(sync('0', { areaId: newId() }))).details).toEqual({ resource: 'AREA' });
    const inactive = await insertArea(prisma, { isActive: false });
    expect((await errorOf(sync('0', { areaId: inactive.id }))).code).toBe('RESOURCE_NOT_FOUND');
    expect((await errorOf(sync('-1'))).code).toBe('VALIDATION_FAILED');
    expect((await errorOf(sync('9007199254740993'))).code).toBe('VALIDATION_FAILED');
    expect(
      (
        await errorOf(
          queries.syncPlaces(
            { areaId: tax.area.id, lang: 'en', since: '0' },
            buildAnonymousContext(),
          ),
        )
      ).code,
    ).toBe('UNAUTHENTICATED');
  });
});
