import {
  AuditAction,
  CATALOG_TOUR_CONTENT_CHANGED,
  NARRATION_LOCALIZATION_READY,
  LocalizationTargetType,
  newId,
  PlaceStatus,
  TranslationSource,
  UploadPurpose,
} from '@wayfare/contracts';
import { catalogGrpc, localizationTargetTypeProto } from '@wayfare/contracts/grpc';
import { FIXTURE_INSIDE } from '@wayfare/contracts/testing';
import { distanceMeters, tourStops } from '@wayfare/core';
import { contentHash } from '@wayfare/nest-common';
import { buildAnonymousContext } from '@wayfare/nest-common/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { insertArea, testPrisma, truncateAll } from '../setup/database';
import {
  confirmedUpload,
  device,
  errorOf,
  insertPlace,
  outboxPayloads,
  staff,
  taxonomy,
} from '../setup/fixtures';
import { catalogServices } from '../setup/services';

const prisma = testPrisma();
const { tours, tourQueries, localizations, queries, offline } = catalogServices(prisma);
const STATUS = catalogGrpc.TourStatus;
let tax: Awaited<ReturnType<typeof taxonomy>>;

beforeEach(async () => {
  await truncateAll(prisma);
  tax = await taxonomy(prisma);
});
afterAll(() => prisma.$disconnect());

/** A point `metres` east of the fixture point. */
const east = (metres: number) => ({
  lat: FIXTURE_INSIDE.lat,
  lng: FIXTURE_INSIDE.lng + metres / (111_320 * Math.cos((FIXTURE_INSIDE.lat * Math.PI) / 180)),
});

const place = (overrides: Partial<Parameters<typeof insertPlace>[1]> = {}) =>
  insertPlace(prisma, { areaId: tax.area.id, categoryId: tax.any.id, ...overrides });

const create = (placeIds: string[], overrides: Partial<catalogGrpc.CreateTourRequest> = {}) =>
  tours.createTour(
    {
      titleVi: 'Danh thắng',
      descriptionVi: 'Một vòng đi bộ.',
      areaId: tax.area.id,
      estimatedMinutes: 90,
      placeIds,
      requestActivation: false,
      ...overrides,
    },
    staff(),
  );

/** narration's English text for the tour, as its consumer receives it. */
const englishArrives = async (tourId: string, hash: string, lang = 'en') =>
  localizations.applyReady(
    NARRATION_LOCALIZATION_READY.schema.parse({
      eventId: newId(),
      occurredAt: new Date().toISOString(),
      targetType: LocalizationTargetType.TOUR,
      targetId: tourId,
      lang,
      sourceContentHash: hash,
      translationSource: TranslationSource.MACHINE,
      text: { title: `[${lang}] Landmarks`, description: `[${lang}] A walk.` },
    }),
    'catalog-narration-localization-ready',
  );

/** Ages every row past the sync lag. */
const settle = async () => {
  await prisma.$executeRaw`UPDATE places SET updated_at = updated_at - interval '10 seconds'`;
  await prisma.$executeRaw`UPDATE tours SET updated_at = updated_at - interval '10 seconds'`;
};

describe('a tour and its stops (rdm-spec C-8 to C-10)', () => {
  it('stores the stops in order with straight legs, and refuses a duplicate or a Place outside', async () => {
    const [a, b, c] = [
      await place(),
      await place({ location: east(100) }),
      await place({ location: east(300) }),
    ];
    const { tour } = await create([a.id, b.id, c.id]);
    expect(tour!.stops.map((stop) => stop.placeId)).toEqual([a.id, b.id, c.id]);
    expect(tour!.stops.map((stop) => stop.legM)).toEqual([
      0,
      distanceMeters(FIXTURE_INSIDE, east(100)),
      distanceMeters(east(100), east(300)),
    ]);
    expect(tour!.distanceM).toBe(tour!.stops.reduce((sum, stop) => sum + stop.legM, 0));
    expect(tour!.status).toBe(STATUS.TOUR_STATUS_DRAFT);

    expect(await errorOf(create([a.id, a.id]))).toEqual({
      code: 'VALIDATION_FAILED',
      details: { issues: [{ path: '/placeIds/1', code: 'duplicate' }] },
    });
    const other = await insertArea(prisma, { code: 'other-area' });
    const outside = await place({ areaId: other.id });
    expect((await errorOf(create([a.id, outside.id]))).details).toEqual({
      issues: [{ path: '/placeIds/1', code: 'outside_area' }],
    });
    expect((await errorOf(create([a.id], { requestActivation: true }))).details).toEqual({
      issues: [{ path: '/placeIds', code: 'too_small' }],
    });
  });

  it('keeps a stop whose Place left the area or Wayfare through a replace; refuses a new one', async () => {
    const [a, b] = [await place(), await place({ location: east(100) })];
    const { tour } = await create([a.id, b.id]);
    const other = await insertArea(prisma, { code: 'moved-to' });
    await prisma.place.update({ where: { id: b.id }, data: { areaId: other.id } });
    const gone = await place({ deleted: true });
    const c = await place({ location: east(200) });
    const { tour: replaced } = await tours.replaceTourStops(
      { tourId: tour!.id, placeIds: [b.id, a.id, c.id] },
      staff(),
    );
    expect(replaced!.stops.map((stop) => [stop.placeId, stop.outsideArea])).toEqual([
      [b.id, true],
      [a.id, false],
      [c.id, false],
    ]);
    expect(replaced!.liveStops).toBe(2);
    expect(
      (
        await errorOf(
          tours.replaceTourStops({ tourId: tour!.id, placeIds: [a.id, gone.id] }, staff()),
        )
      ).details,
    ).toEqual({ issues: [{ path: '/placeIds/1', code: 'not_found' }] });
    const audit = await outboxPayloads(prisma, 'audit.record');
    expect(audit).toContainEqual(
      expect.objectContaining({
        action: AuditAction.TOUR_STOPS_REPLACED,
        metadata: { before: { placeIds: [a.id, b.id] }, after: { placeIds: [b.id, a.id, c.id] } },
      }),
    );
  });
});

describe('one code space (K2)', () => {
  it("never lets a tour take a Place's code, and resolves each to its type", async () => {
    const a = await place();
    const b = await place();
    const { tour } = await create([a.id, b.id]);
    // A tour inserted with a Place's code is refused by the code space's key (its trigger).
    await expect(
      prisma.$executeRaw`
        INSERT INTO tours (id, public_code, area_id, title_vi, description_vi, content_hash,
                           estimated_minutes, distance_m, status, sync_version, created_by_id)
        VALUES (${newId()}::uuid, ${b.publicCode}, ${tax.area.id}::uuid, 'x', 'y', ${'0'.repeat(64)},
                30, 0, 'DRAFT', nextval('catalog_sync_version_seq'), ${newId()}::uuid)`,
    ).rejects.toThrow();
    const anonymous = device();
    const asTour = await queries.resolvePublicCode(
      {
        publicCode: (await prisma.publicCode.findFirstOrThrow({ where: { targetId: tour!.id } }))
          .code,
        countScan: true,
      },
      anonymous,
    );
    expect(asTour).toMatchObject({
      exists: true,
      targetType: catalogGrpc.CodeTargetType.CODE_TARGET_TYPE_TOUR,
      targetId: tour!.id,
    });
    expect(await prisma.placeQrScanDaily.count()).toBe(0);
    const asPlace = await queries.resolvePublicCode(
      { publicCode: a.publicCode, countScan: true },
      anonymous,
    );
    expect(asPlace).toMatchObject({
      targetType: catalogGrpc.CodeTargetType.CODE_TARGET_TYPE_PLACE,
      targetId: a.id,
    });
    expect(await prisma.placeQrScanDaily.count()).toBe(1);
  });
});

describe("a tour's text (K3)", () => {
  it('asks narration for it on create and on a text change, and opens the gate on English', async () => {
    const [a, b] = [await place(), await place({ location: east(100) })];
    const { tour } = await create([a.id, b.id], { requestActivation: true });
    expect(tour!.status).toBe(STATUS.TOUR_STATUS_PROCESSING);
    expect(tour!.activationMissing).toEqual(['en.text']);
    const asked = await outboxPayloads(prisma, CATALOG_TOUR_CONTENT_CHANGED.subject);
    expect(asked).toEqual([
      expect.objectContaining({ tourId: tour!.id, contentHash: tour!.contentHash }),
    ]);

    await englishArrives(tour!.id, tour!.contentHash, 'fr');
    expect((await tours.getTourAdmin({ tourId: tour!.id }, staff())).tour!.status).toBe(
      STATUS.TOUR_STATUS_PROCESSING,
    );
    const before = (await prisma.tour.findUniqueOrThrow({ where: { id: tour!.id } })).syncVersion;
    await englishArrives(tour!.id, tour!.contentHash);
    const live = (await tours.getTourAdmin({ tourId: tour!.id }, staff())).tour!;
    expect(live.status).toBe(STATUS.TOUR_STATUS_ACTIVE);
    expect(live.localizations.map((row) => row.lang)).toEqual(['en', 'fr']);
    expect(BigInt(live.syncVersion)).toBeGreaterThan(before);
    expect(await outboxPayloads(prisma, 'audit.record')).toContainEqual(
      expect.objectContaining({ action: AuditAction.TOUR_ACTIVATED, actor: { type: 'SYSTEM' } }),
    );
    // No owner to tell: a tour going live sends no notification.
    expect(await outboxPayloads(prisma, 'notification.create')).toEqual([]);

    const { tour: edited } = await tours.updateTour(
      { tourId: tour!.id, descriptionVi: 'Mô tả mới.', removeCover: false },
      staff(),
    );
    expect(edited!.status).toBe(STATUS.TOUR_STATUS_PROCESSING);
    expect(edited!.contentHash).toBe(
      contentHash({ name: 'Danh thắng', description: 'Mô tả mới.' }),
    );
    expect(await outboxPayloads(prisma, CATALOG_TOUR_CONTENT_CHANGED.subject)).toHaveLength(2);
    // Minutes alone don't send it back through processing.
    await englishArrives(tour!.id, edited!.contentHash);
    const { tour: timed } = await tours.updateTour(
      { tourId: tour!.id, estimatedMinutes: 120, removeCover: false },
      staff(),
    );
    expect(timed!.status).toBe(STATUS.TOUR_STATUS_ACTIVE);
  });

  it('serves its source to narration, and a cover through uploads', async () => {
    const a = await place();
    const context = staff();
    const upload = await confirmedUpload(prisma, context.userId, {
      purpose: UploadPurpose.TOUR_COVER,
    });
    const { tour } = await tours.createTour(
      {
        titleVi: 'Có ảnh',
        descriptionVi: 'Mô tả.',
        areaId: tax.area.id,
        estimatedMinutes: 30,
        coverUploadId: upload.id,
        placeIds: [a.id],
        requestActivation: false,
      },
      context,
    );
    expect(tour!.cover?.card?.sha256).toBe(upload.variants.card.sha256);
    const { sources } = catalogServices(prisma);
    const source = await sources.getLocalizationSource(
      {
        targetType: localizationTargetTypeProto.toProto(LocalizationTargetType.TOUR),
        targetId: tour!.id,
      },
      device(),
    );
    expect(source.tour).toMatchObject({
      titleVi: 'Có ảnh',
      contentHash: tour!.contentHash,
      deleted: false,
    });
  });
});

describe('the admin list and lifecycle (K4)', () => {
  it("counts live stops, flags a tour tourists can't see, and deactivates, deletes and restores", async () => {
    const [a, b] = [await place(), await place({ location: east(100) })];
    const { tour } = await create([a.id, b.id]);
    const row = async () =>
      (
        await tours.listTours(
          { page: { page: 1, pageSize: 20, sort: '-updatedAt' }, includeDeleted: true },
          staff(),
        )
      ).tours[0]!;
    expect(await row()).toMatchObject({ liveStops: 2, totalStops: 2, hiddenFromTourists: false });
    await prisma.place.update({
      where: { id: b.id },
      data: { status: PlaceStatus.INACTIVE, inactiveReason: 'ADMIN' },
    });
    expect(await row()).toMatchObject({ liveStops: 1, hiddenFromTourists: true });

    await tours.requestTourActivation({ tourId: tour!.id }, staff());
    await englishArrives(tour!.id, tour!.contentHash);
    const { tour: off } = await tours.deactivateTour({ tourId: tour!.id }, staff());
    expect(off).toMatchObject({ status: STATUS.TOUR_STATUS_INACTIVE, inactiveByAdmin: true });
    await tours.deleteTour({ tourId: tour!.id }, staff());
    expect(await errorOf(tours.deleteTour({ tourId: tour!.id }, staff()))).toMatchObject({
      code: 'INVALID_STATE',
    });
    const { tour: back } = await tours.restoreTour({ tourId: tour!.id }, staff());
    expect(back!.deletedAt).toBeUndefined();
    expect(
      (await tours.getTourQr({ tourId: tour!.id, qrBaseUrl: 'https://go.example' }, staff())).svg,
    ).toContain('<svg');
  });

  it('refuses to delete a Place a live tour lists (api-endpoints-plan §3.5)', async () => {
    const [a, b] = [await place(), await place({ location: east(100) })];
    const { tour } = await create([a.id, b.id], { requestActivation: true });
    await englishArrives(tour!.id, tour!.contentHash);
    const { places } = catalogServices(prisma);
    expect(await errorOf(places.deletePlace({ placeId: a.id }, staff()))).toMatchObject({
      code: 'PLACE_IN_ACTIVE_TOUR',
    });
  });
});

describe("the tourist's reads (K6)", () => {
  it('keeps positions, shows a stop not live as a gap, and is unavailable under two live stops', async () => {
    const [a, b, c] = [
      await place(),
      await place({ location: east(100) }),
      await place({ location: east(200) }),
    ];
    const { tour } = await create([a.id, b.id, c.id], { requestActivation: true });
    await englishArrives(tour!.id, tour!.contentHash);
    await prisma.place.update({
      where: { id: b.id },
      data: { status: PlaceStatus.INACTIVE, inactiveReason: 'ADMIN' },
    });

    const { tour: detail } = await tourQueries.getTour({ tourId: tour!.id, lang: 'en' }, device());
    expect(detail!.stops.map((stop) => [stop.position, stop.place?.id ?? null])).toEqual([
      [0, a.id],
      [1, null],
      [2, c.id],
    ]);
    // The leg across the gap is from the live stop before it.
    expect(detail!.stops[2]!.legM).toBe(distanceMeters(FIXTURE_INSIDE, east(200)));
    expect(detail!.summary).toMatchObject({
      stopCount: 2,
      text: expect.objectContaining({ title: '[en] Landmarks' }),
    });
    // Token-less, as the web's server reads it.
    const byCode = await tourQueries.getTourByCode(
      { publicCode: tour!.publicCode, lang: 'vi' },
      buildAnonymousContext(),
    );
    expect(byCode.tour!.summary!.text!.title).toBe('Danh thắng');

    await prisma.place.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
    expect(await errorOf(tourQueries.getTour({ tourId: tour!.id, lang: 'en' }, device()))).toEqual({
      code: 'TOUR_UNAVAILABLE',
      details: { areaCode: tax.area.code },
    });
    expect(
      (await errorOf(tourQueries.getTour({ tourId: newId(), lang: 'en' }, device()))).code,
    ).toBe('RESOURCE_NOT_FOUND');
    expect(
      (
        await tourQueries.listTours(
          { areaId: tax.area.id, lang: 'en', page: { limit: 20 } },
          device(),
        )
      ).tours,
    ).toEqual([]);
  });
});

describe('tours offline (K7, K18, K20)', () => {
  it('syncs a delta by area, bumps on a translation and a stops replace, and tombstones', async () => {
    const [a, b] = [await place(), await place({ location: east(100) })];
    const { tour } = await create([a.id, b.id], { requestActivation: true });
    await englishArrives(tour!.id, tour!.contentHash);
    await settle();
    const first = await tourQueries.syncTours(
      { areaId: tax.area.id, lang: 'en', since: '' },
      device(),
    );
    expect(
      first.tours.map((record) => [record.id, record.stops.map((stop) => stop.placeId)]),
    ).toEqual([[tour!.id, [a.id, b.id]]]);
    const since = first.datasetVersion;
    await tours.replaceTourStops({ tourId: tour!.id, placeIds: [b.id, a.id] }, staff());
    await settle();
    const moved = await tourQueries.syncTours({ areaId: tax.area.id, lang: 'en', since }, device());
    expect(moved.tours[0]!.stops.map((stop) => stop.placeId)).toEqual([b.id, a.id]);
    await tours.deleteTour({ tourId: tour!.id }, staff());
    await settle();
    const removed = await tourQueries.syncTours(
      { areaId: tax.area.id, lang: 'en', since: moved.datasetVersion },
      device(),
    );
    expect(removed.removedTourIds).toEqual([tour!.id]);
  });

  it("agrees with the phone's rule on live stops, and adds nothing to the Places' records", async () => {
    const [a, b, c] = [
      await place(),
      await place({ location: east(100) }),
      await place({ location: east(200) }),
    ];
    await settle();
    const before = await queries.syncPlaces(
      { areaId: tax.area.id, lang: 'en', since: '' },
      device(),
    );
    const { tour } = await create([a.id, b.id, c.id], { requestActivation: true });
    await englishArrives(tour!.id, tour!.contentHash);
    await settle();
    const after = await queries.syncPlaces(
      { areaId: tax.area.id, lang: 'en', since: '' },
      device(),
    );
    // The firewall (ADR 0007): a tour changes nothing narration reads about its Places.
    expect(JSON.stringify(after.places)).toBe(JSON.stringify(before.places));

    await prisma.place.update({
      where: { id: b.id },
      data: { status: PlaceStatus.INACTIVE, inactiveReason: 'ADMIN' },
    });
    const { tour: served } = await tourQueries.getTour({ tourId: tour!.id, lang: 'en' }, device());
    // The phone holds Place ids by position and its own Places; the same rule gives the same view.
    const live = new Map([
      [a.id, FIXTURE_INSIDE],
      [c.id, east(200)],
    ]);
    const synced = (
      await tourQueries.syncTours({ areaId: tax.area.id, lang: 'en', since: '' }, device())
    ).tours[0]!;
    const phone = tourStops(
      synced.stops.map((stop) => ({
        position: stop.position,
        live: live.get(stop.placeId) ?? null,
      })),
    );
    expect(phone.map((stop) => [stop.position, stop.live, stop.legM])).toEqual(
      served!.stops.map((stop) => [stop.position, stop.place !== undefined, stop.legM]),
    );
  });

  it("lists a downloaded area's tour covers in its manifest", async () => {
    const [a, b] = [await place(), await place({ location: east(100) })];
    const context = staff();
    const upload = await confirmedUpload(prisma, context.userId, {
      purpose: UploadPurpose.TOUR_COVER,
    });
    const { tour } = await tours.createTour(
      {
        titleVi: 'Có ảnh',
        descriptionVi: 'Mô tả.',
        areaId: tax.area.id,
        estimatedMinutes: 30,
        coverUploadId: upload.id,
        placeIds: [a.id, b.id],
        requestActivation: true,
      },
      context,
    );
    await englishArrives(tour!.id, tour!.contentHash);
    await settle();
    const { manifestJson } = await offline.getManifest(
      { areaId: tax.area.id, lang: 'en' },
      device(),
    );
    const manifest = JSON.parse(manifestJson) as { photos: { sha256: string }[] };
    expect(manifest.photos.map((photo) => photo.sha256)).toContain(upload.variants.card.sha256);
  });
});
