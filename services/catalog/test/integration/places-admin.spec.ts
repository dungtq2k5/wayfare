import {
  AUDIT_RECORD,
  CATALOG_MENU_CONTENT_CHANGED,
  CATALOG_PLACE_CONTENT_CHANGED,
  CATALOG_PLACE_STATUS_CHANGED,
  CONTENT_LANGUAGES,
  newId,
  NOTIFICATION_CREATE,
  PlaceKind,
  PlaceStatus,
} from '@wayfare/contracts';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { FIXTURE_OUTSIDE } from '@wayfare/contracts/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';
import {
  confirmedUpload,
  contentInput,
  createRequest,
  errorOf,
  insertLocalization,
  insertPlace,
  outboxPayloads,
  staff,
  taxonomy,
  updateRequest,
} from '../setup/fixtures';
import { catalogServices } from '../setup/services';

const prisma = testPrisma();
const { places } = catalogServices(prisma);
const S = catalogGrpc.PlaceStatus;
let tax: Awaited<ReturnType<typeof taxonomy>>;

beforeEach(async () => {
  await truncateAll(prisma);
  tax = await taxonomy(prisma);
});
afterAll(() => prisma.$disconnect());

const actions = async () =>
  (await outboxPayloads(prisma, AUDIT_RECORD.subject)).map((payload) => payload.action);

const syncVersion = async (id: string) =>
  (await prisma.place.findUniqueOrThrow({ where: { id }, select: { syncVersion: true } }))
    .syncVersion;

/** A created Editorial Place, activation requested. */
async function processingPlace(actor = staff()) {
  const { place } = await places.createEditorialPlace(
    createRequest({ requestActivation: true }),
    actor,
  );
  return place!;
}

/** A live Editorial Place: created, then its gate opened with ready en rows. */
async function activePlace(actor = staff()) {
  const place = await processingPlace(actor);
  await insertLocalization(prisma, place.id, 'en', place.contentHash);
  const activated = await places.requestActivation({ placeId: place.id }, actor);
  expect(activated.status).toBe(S.PLACE_STATUS_ACTIVE);
  await prisma.outboxEvent.deleteMany();
  return place;
}

describe('CreateEditorialPlace', () => {
  it('creates a Draft with photos and hours, and asks narration nothing', async () => {
    const actor = staff();
    const upload = await confirmedUpload(prisma, actor.userId);
    const { place } = await places.createEditorialPlace(
      createRequest({
        content: contentInput({ addressVi: 'Lê Lợi', priceBand: 2, phone: '+84901234567' }),
        photos: [{ uploadId: upload.id, altTextVi: 'Cổng chợ' }],
        openingHours: [
          { weekday: 1, opensAt: '06:00', closesAt: '18:00', isClosed: false },
          { specificDate: '2027-02-06', isClosed: true },
        ],
      }),
      actor,
    );
    expect(place).toMatchObject({
      kind: catalogGrpc.PlaceKind.PLACE_KIND_EDITORIAL,
      status: S.PLACE_STATUS_DRAFT,
      nameVi: 'Chợ Bến Thành',
      addressVi: 'Lê Lợi',
      priceBand: 2,
      autoNarrationEnabled: true,
      discoveryBoost: 0,
      areaId: tax.area.id,
      activationMissing: ['en.text', 'en.audio', 'activation'],
      openingHours: [
        { weekday: 1, opensAt: '06:00', closesAt: '18:00', isClosed: false },
        { specificDate: '2027-02-06', isClosed: true },
      ],
    });
    expect(place!.publicCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(place!.location).toEqual({ lat: 10.7725, lng: 106.698 });
    expect(place!.photos).toHaveLength(1);
    expect(place!.photos[0]).toMatchObject({
      altTextVi: 'Cổng chợ',
      originalSha256: upload.sha256,
    });
    expect(place!.photos[0]!.variants!.card!.url).toBe(
      `http://localhost:4443/wayfare-media-test/photos/${upload.id}/card.webp`,
    );
    expect(await actions()).toEqual(['PLACE_CREATED']);
    const [audit] = await outboxPayloads(prisma, AUDIT_RECORD.subject);
    expect(audit).toMatchObject({
      service: 'catalog',
      metadata: { after: { kind: 'EDITORIAL', status: 'DRAFT', categoryCode: 'MARKET' } },
    });
    expect(await outboxPayloads(prisma, CATALOG_PLACE_CONTENT_CHANGED.subject)).toEqual([]);
    const consumed = await prisma.pendingUpload.findUniqueOrThrow({ where: { id: upload.id } });
    expect(consumed.consumedAt).not.toBeNull();
  });

  it('with activation requested, is PROCESSING and asks for every launch language', async () => {
    const place = await processingPlace();
    expect(place.status).toBe(S.PLACE_STATUS_PROCESSING);
    const [event] = await outboxPayloads(prisma, CATALOG_PLACE_CONTENT_CHANGED.subject);
    expect(event).toMatchObject({
      placeId: place.id,
      contentHash: place.contentHash,
      trigger: 'APPROVAL',
      langs: [...CONTENT_LANGUAGES],
    });
    // Creation is no visibility change.
    expect(await outboxPayloads(prisma, CATALOG_PLACE_STATUS_CHANGED.subject)).toEqual([]);
  });

  it('hashes NFC text, so decomposed Vietnamese hashes the same', async () => {
    const composed = await processingPlace();
    const decomposed = await places.createEditorialPlace(
      createRequest({ content: contentInput({ nameVi: 'Chợ Bến Thành'.normalize('NFD') }) }),
      staff(),
    );
    expect(decomposed.place!.contentHash).toBe(composed.contentHash);
    expect(decomposed.place!.publicCode).not.toBe(composed.publicCode);
  });

  it('refuses a Venue-only category, an unknown one, and a point outside every area', async () => {
    const venueOnly = createRequest({ content: contentInput({ categoryCode: 'RESTAURANT' }) });
    expect((await errorOf(places.createEditorialPlace(venueOnly, staff()))).code).toBe(
      'CATEGORY_NOT_APPLICABLE',
    );
    const unknown = createRequest({ content: contentInput({ categoryCode: 'NOPE' }) });
    expect(await errorOf(places.createEditorialPlace(unknown, staff()))).toEqual({
      code: 'RESOURCE_NOT_FOUND',
      details: { resource: 'CATEGORY' },
    });
    const outside = createRequest({ content: contentInput({ location: FIXTURE_OUTSIDE }) });
    expect((await errorOf(places.createEditorialPlace(outside, staff()))).code).toBe(
      'LOCATION_OUTSIDE_AREAS',
    );
    await prisma.area.updateMany({ data: { isActive: false } });
    expect((await errorOf(places.createEditorialPlace(createRequest(), staff()))).code).toBe(
      'LOCATION_OUTSIDE_AREAS',
    );
    expect(await prisma.place.count()).toBe(0);
  });

  it('refuses the editorial values out of bounds and a missing location', async () => {
    for (const request of [
      createRequest({ triggerRadiusM: 101 }),
      createRequest({ narrationPriority: -1 }),
      createRequest({ content: { ...contentInput(), location: null as never } }),
      createRequest({ content: contentInput({ websiteUrl: 'http://insecure.example' }) }),
    ]) {
      expect((await errorOf(places.createEditorialPlace(request, staff()))).code).toBe(
        'VALIDATION_FAILED',
      );
    }
  });

  it('refuses an upload that is not ready, someone else’s, or already used', async () => {
    const actor = staff();
    const theirs = await confirmedUpload(prisma, newId());
    const used = await confirmedUpload(prisma, actor.userId, { consumedAt: new Date() });
    const tourCover = await confirmedUpload(prisma, actor.userId, {
      purpose: 'TOUR_COVER' as never,
    });
    const stale = await confirmedUpload(prisma, actor.userId, {
      confirmedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    });
    for (const uploadId of [theirs.id, used.id, tourCover.id, stale.id, newId()]) {
      const failure = await errorOf(
        places.createEditorialPlace(createRequest({ photos: [{ uploadId }] }), actor),
      );
      expect(failure.code).toBe('UPLOAD_NOT_READY');
    }
    expect(await prisma.place.count()).toBe(0);
  });

  it('refuses the same file twice, and a kept photo id on create', async () => {
    const actor = staff();
    const upload = await confirmedUpload(prisma, actor.userId);
    const twin = await confirmedUpload(prisma, actor.userId);
    await prisma.pendingUpload.update({ where: { id: twin.id }, data: { sha256: upload.sha256 } });
    const failure = await errorOf(
      places.createEditorialPlace(
        createRequest({ photos: [{ uploadId: upload.id }, { uploadId: twin.id }] }),
        actor,
      ),
    );
    expect(failure).toEqual({
      code: 'VALIDATION_FAILED',
      details: { issues: [{ path: '/items/1', code: 'custom' }] },
    });
    const kept = await errorOf(
      places.createEditorialPlace(createRequest({ photos: [{ photoId: newId() }] }), actor),
    );
    expect(kept.code).toBe('VALIDATION_FAILED');
  });
});

describe('UpdatePlace', () => {
  it('a text edit on a live Place goes back through PROCESSING, once, with a new hash', async () => {
    const place = await activePlace();
    const before = await syncVersion(place.id);
    const { place: edited } = await places.updatePlace(
      updateRequest(place.id, { descriptionVi: 'Một mô tả mới.' }),
      staff(),
    );
    expect(edited).toMatchObject({
      status: S.PLACE_STATUS_PROCESSING,
      descriptionVi: 'Một mô tả mới.',
    });
    expect(edited!.contentHash).not.toBe(place.contentHash);
    expect(await syncVersion(place.id)).toBeGreaterThan(before);
    expect(await outboxPayloads(prisma, CATALOG_PLACE_CONTENT_CHANGED.subject)).toEqual([
      expect.objectContaining({ trigger: 'CONTENT_CHANGED', contentHash: edited!.contentHash }),
    ]);
    expect(await outboxPayloads(prisma, CATALOG_PLACE_STATUS_CHANGED.subject)).toEqual([
      expect.objectContaining({ from: 'ACTIVE', to: 'PROCESSING', deleted: false, reason: null }),
    ]);
    const [audit] = await outboxPayloads(prisma, AUDIT_RECORD.subject);
    expect(audit).toMatchObject({
      action: 'PLACE_EDITED',
      metadata: { after: { changedFields: ['descriptionVi'], contentChanged: true } },
    });
  });

  it('a whitespace-only edit is no content change and keeps the Place live', async () => {
    const place = await activePlace();
    const { place: edited } = await places.updatePlace(
      updateRequest(place.id, { descriptionVi: `  ${place.descriptionVi}  ` }),
      staff(),
    );
    expect(edited!.status).toBe(S.PLACE_STATUS_ACTIVE);
    expect(await actions()).toEqual([]);
  });

  it('other fields keep it live; a move re-checks the area; empty values clear', async () => {
    const place = await activePlace();
    await places.updatePlace(
      updateRequest(place.id, { phone: '+84901234567', priceBand: 3 }),
      staff(),
    );
    const { place: edited } = await places.updatePlace(
      updateRequest(place.id, { location: { lat: 10.77, lng: 106.7 }, phone: '', priceBand: 0 }),
      staff(),
    );
    expect(edited).toMatchObject({
      status: S.PLACE_STATUS_ACTIVE,
      location: { lat: 10.77, lng: 106.7 },
    });
    expect(edited!.phone).toBeUndefined();
    expect(edited!.priceBand).toBeUndefined();
    expect(await outboxPayloads(prisma, CATALOG_PLACE_CONTENT_CHANGED.subject)).toEqual([]);
    const moved = await errorOf(
      places.updatePlace(updateRequest(place.id, { location: FIXTURE_OUTSIDE }), staff()),
    );
    expect(moved.code).toBe('LOCATION_OUTSIDE_AREAS');
  });

  it('a Draft edit asks narration nothing; a Venue edit tells its owner', async () => {
    const { place: draft } = await places.createEditorialPlace(createRequest(), staff());
    await places.updatePlace(updateRequest(draft!.id, { nameVi: 'Tên mới' }), staff());
    expect(await outboxPayloads(prisma, CATALOG_PLACE_CONTENT_CHANGED.subject)).toEqual([]);

    const venue = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.venueOnly.id,
      kind: PlaceKind.VENUE,
    });
    await places.updatePlace(updateRequest(venue.id, { nameVi: 'Quán mới' }), staff());
    const owner = await prisma.place.findUniqueOrThrow({ where: { id: venue.id } });
    expect(await outboxPayloads(prisma, NOTIFICATION_CREATE.subject)).toEqual([
      expect.objectContaining({
        recipientUserId: owner.ownerUserId,
        notification: { type: 'PLACE_EDITED_BY_ADMIN', data: { placeId: venue.id } },
      }),
    ]);
    // A Venue asks for the basic scope until its entitlement is known.
    expect(await outboxPayloads(prisma, CATALOG_PLACE_CONTENT_CHANGED.subject)).toEqual([
      expect.objectContaining({ placeId: venue.id, langs: ['vi', 'en'] }),
    ]);
  });

  it('refuses an unknown or deleted Place', async () => {
    expect(
      await errorOf(places.updatePlace(updateRequest(newId(), { nameVi: 'x' }), staff())),
    ).toEqual({
      code: 'RESOURCE_NOT_FOUND',
      details: { resource: 'PLACE' },
    });
    const place = await processingPlace();
    await places.deletePlace({ placeId: place.id }, staff());
    expect(
      await errorOf(places.updatePlace(updateRequest(place.id, { nameVi: 'x' }), staff())),
    ).toEqual({
      code: 'INVALID_STATE',
      details: { status: 'DELETED' },
    });
  });
});

describe('UpdateEditorial', () => {
  it('writes the editorial values with before and after, never the status', async () => {
    const place = await activePlace();
    const { place: edited } = await places.updateEditorial(
      { placeId: place.id, triggerRadiusM: 50 },
      staff(),
    );
    expect(edited).toMatchObject({
      triggerRadiusM: 50,
      narrationPriority: 50,
      status: S.PLACE_STATUS_ACTIVE,
    });
    const [audit] = await outboxPayloads(prisma, AUDIT_RECORD.subject);
    expect(audit).toMatchObject({
      action: 'PLACE_EDITORIAL_UPDATED',
      metadata: {
        before: { triggerRadiusM: 30, narrationPriority: 50 },
        after: { triggerRadiusM: 50, narrationPriority: 50 },
      },
    });
    await places.updateEditorial({ placeId: place.id, triggerRadiusM: 50 }, staff());
    expect(await actions()).toEqual(['PLACE_EDITORIAL_UPDATED']);
  });
});

describe('ReplacePhotos', () => {
  it('keeps, reorders, adds and removes — listing removed objects for cleanup', async () => {
    const actor = staff();
    const first = await confirmedUpload(prisma, actor.userId);
    const second = await confirmedUpload(prisma, actor.userId);
    const { place } = await places.createEditorialPlace(
      createRequest({ photos: [{ uploadId: first.id }, { uploadId: second.id }] }),
      actor,
    );
    const [keep, drop] = place!.photos;
    const third = await confirmedUpload(prisma, actor.userId);
    const before = await syncVersion(place!.id);
    const { place: replaced } = await places.replacePhotos(
      {
        placeId: place!.id,
        items: [{ uploadId: third.id, altTextVi: 'Mới' }, { photoId: keep!.id }],
      },
      actor,
    );
    expect(replaced!.photos.map((photo) => [photo.originalSha256, photo.sortOrder])).toEqual([
      [third.sha256, 0],
      [first.sha256, 1],
    ]);
    expect(replaced!.status).toBe(S.PLACE_STATUS_DRAFT);
    expect(await syncVersion(place!.id)).toBeGreaterThan(before);
    const orphaned = await prisma.orphanedObject.findMany({ orderBy: { objectPath: 'asc' } });
    expect(orphaned.map((row) => row.objectPath)).toEqual([
      second.variants.card.objectPath,
      second.variants.full.objectPath,
      second.variants.thumb.objectPath,
    ]);
    expect(drop!.originalSha256).toBe(second.sha256);
    const [, audit] = await outboxPayloads(prisma, AUDIT_RECORD.subject);
    expect(audit).toMatchObject({
      action: 'PLACE_PHOTOS_REPLACED',
      metadata: { after: { photoCount: 2 } },
    });
  });

  it('refuses another Place’s photo, a repeated id, and a ninth photo', async () => {
    const actor = staff();
    const upload = await confirmedUpload(prisma, actor.userId);
    const { place: other } = await places.createEditorialPlace(
      createRequest({ photos: [{ uploadId: upload.id }] }),
      actor,
    );
    const { place } = await places.createEditorialPlace(createRequest(), actor);
    const foreign = await errorOf(
      places.replacePhotos(
        { placeId: place!.id, items: [{ photoId: other!.photos[0]!.id }] },
        actor,
      ),
    );
    expect(foreign).toEqual({
      code: 'VALIDATION_FAILED',
      details: { issues: [{ path: '/items/0/photoId', code: 'invalid_value' }] },
    });
    const own = other!.photos[0]!.id;
    const repeated = await errorOf(
      places.replacePhotos(
        { placeId: other!.id, items: [{ photoId: own }, { photoId: own }] },
        actor,
      ),
    );
    expect(repeated.code).toBe('VALIDATION_FAILED');
    const nine = Array.from({ length: 9 }, () => ({ uploadId: newId() }));
    expect(
      (await errorOf(places.replacePhotos({ placeId: place!.id, items: nine }, actor))).code,
    ).toBe('VALIDATION_FAILED');
  });
});

describe('ReplaceMenu', () => {
  it('refuses an Editorial Place', async () => {
    const place = await processingPlace();
    const failure = await errorOf(
      places.replaceMenu(
        { placeId: place.id, menuCurrency: catalogGrpc.MenuCurrency.MENU_CURRENCY_VND, items: [] },
        staff(),
      ),
    );
    expect(failure).toEqual({ code: 'INVALID_STATE', details: { status: 'EDITORIAL' } });
  });

  it('replaces a Venue menu, keeping unchanged lines and asking for new ones only', async () => {
    const venue = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.venueOnly.id,
      kind: PlaceKind.VENUE,
    });
    const VND = catalogGrpc.MenuCurrency.MENU_CURRENCY_VND;
    const first = await places.replaceMenu(
      {
        placeId: venue.id,
        menuCurrency: VND,
        items: [
          { nameVi: 'Phở bò', priceMinor: 50_000, isAvailable: true },
          { nameVi: 'Bún chả', descriptionVi: 'Hà Nội', isAvailable: true },
        ],
      },
      staff(),
    );
    const [pho] = first.place!.menuItems;
    const second = await places.replaceMenu(
      {
        placeId: venue.id,
        menuCurrency: catalogGrpc.MenuCurrency.MENU_CURRENCY_USD,
        items: [
          { nameVi: 'Cà phê', priceMinor: 200, isAvailable: true },
          { nameVi: 'Phở bò', priceMinor: 300, isAvailable: false },
        ],
      },
      staff(),
    );
    expect(second.place!.menuCurrency).toBe(catalogGrpc.MenuCurrency.MENU_CURRENCY_USD);
    expect(
      second.place!.menuItems.map((item) => [item.nameVi, item.priceMinor, item.isAvailable]),
    ).toEqual([
      ['Cà phê', 200, true],
      ['Phở bò', 300, false],
    ]);
    expect(second.place!.menuItems[1]!.id).toBe(pho!.id);
    const events = await outboxPayloads(prisma, CATALOG_MENU_CONTENT_CHANGED.subject);
    expect(events.map((event) => (event.menuItemIds as string[]).length)).toEqual([2, 1]);
    expect(events[1]!.menuItemIds).toEqual([second.place!.menuItems[0]!.id]);
  });

  it('refuses a price above the currency ceiling', async () => {
    const venue = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.venueOnly.id,
      kind: PlaceKind.VENUE,
    });
    const failure = await errorOf(
      places.replaceMenu(
        {
          placeId: venue.id,
          menuCurrency: catalogGrpc.MenuCurrency.MENU_CURRENCY_USD,
          items: [{ nameVi: 'Tôm hùm', priceMinor: 200_001, isAvailable: true }],
        },
        staff(),
      ),
    );
    expect(failure).toEqual({
      code: 'VALIDATION_FAILED',
      details: { issues: [{ path: '/items/0/priceMinor', code: 'too_big' }] },
    });
  });
});

describe('ReplaceOpeningHours', () => {
  it('replaces the list and refuses a row breaking C-16', async () => {
    const place = await processingPlace();
    const { place: replaced } = await places.replaceOpeningHours(
      {
        placeId: place.id,
        rows: [{ weekday: 7, opensAt: '17:00', closesAt: '02:00', isClosed: false }],
      },
      staff(),
    );
    expect(replaced!.openingHours).toEqual([
      { weekday: 7, opensAt: '17:00', closesAt: '02:00', isClosed: false },
    ]);
    const failure = await errorOf(
      places.replaceOpeningHours(
        { placeId: place.id, rows: [{ weekday: 1, isClosed: false }] },
        staff(),
      ),
    );
    expect(failure.code).toBe('VALIDATION_FAILED');
  });
});

describe('RequestActivation', () => {
  it('from Draft: PROCESSING, asks narration, and says what is missing', async () => {
    const { place } = await places.createEditorialPlace(createRequest(), staff());
    const result = await places.requestActivation({ placeId: place!.id }, staff());
    expect(result).toEqual({ status: S.PLACE_STATUS_PROCESSING, missing: ['en.text', 'en.audio'] });
    expect(await outboxPayloads(prisma, CATALOG_PLACE_CONTENT_CHANGED.subject)).toEqual([
      expect.objectContaining({ trigger: 'APPROVAL' }),
    ]);
    // A status change, though neither status is visible: consumers decide what matters.
    expect(await outboxPayloads(prisma, CATALOG_PLACE_STATUS_CHANGED.subject)).toEqual([
      expect.objectContaining({ from: 'DRAFT', to: 'PROCESSING' }),
    ]);
  });

  it('opens the gate at once when en text and audio are ready, stamping publication', async () => {
    const place = await processingPlace();
    await insertLocalization(prisma, place.id, 'en', place.contentHash, { audioHash: null });
    expect(await places.requestActivation({ placeId: place.id }, staff())).toEqual({
      status: S.PLACE_STATUS_PROCESSING,
      missing: ['en.audio'],
    });
    await prisma.placeLocalization.deleteMany();
    await insertLocalization(prisma, place.id, 'en', place.contentHash);
    expect(await places.requestActivation({ placeId: place.id }, staff())).toEqual({
      status: S.PLACE_STATUS_ACTIVE,
      missing: [],
    });
    const row = await prisma.place.findUniqueOrThrow({ where: { id: place.id } });
    expect(row.publishedAt).not.toBeNull();
    expect(await actions()).toEqual([
      'PLACE_CREATED',
      'PLACE_ACTIVATION_REQUESTED',
      'PLACE_ACTIVATION_REQUESTED',
      'PLACE_ACTIVATED',
    ]);
    expect(await places.requestActivation({ placeId: place.id }, staff())).toEqual({
      status: S.PLACE_STATUS_ACTIVE,
      missing: [],
    });
  });

  it('reactivates an admin deactivation in one step, publishing the net change once', async () => {
    const place = await activePlace();
    await places.deactivatePlace({ placeId: place.id, reason: 'Sửa chữa' }, staff());
    await places.requestActivation({ placeId: place.id }, staff());
    expect(await outboxPayloads(prisma, CATALOG_PLACE_STATUS_CHANGED.subject)).toEqual([
      expect.objectContaining({ from: 'ACTIVE', to: 'INACTIVE', reason: 'ADMIN' }),
      expect.objectContaining({ from: 'INACTIVE', to: 'ACTIVE', reason: null }),
    ]);
  });

  it('refuses a Venue its owner closed', async () => {
    const venue = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.venueOnly.id,
      kind: PlaceKind.VENUE,
      status: PlaceStatus.INACTIVE,
    });
    await prisma.place.update({ where: { id: venue.id }, data: { inactiveReason: 'OWNER' } });
    expect(await errorOf(places.requestActivation({ placeId: venue.id }, staff()))).toEqual({
      code: 'INVALID_STATE',
      details: { status: 'INACTIVE' },
    });
  });
});

describe('DeactivatePlace', () => {
  it('takes a live Place offline with the reason in the audit row only', async () => {
    const place = await activePlace();
    const { place: inactive } = await places.deactivatePlace(
      { placeId: place.id, reason: 'Đóng cửa' },
      staff(),
    );
    expect(inactive).toMatchObject({
      status: S.PLACE_STATUS_INACTIVE,
      inactiveReason: catalogGrpc.PlaceInactiveReason.PLACE_INACTIVE_REASON_ADMIN,
    });
    const [audit] = await outboxPayloads(prisma, AUDIT_RECORD.subject);
    expect(audit).toMatchObject({
      action: 'PLACE_DEACTIVATED',
      metadata: { before: { status: 'ACTIVE' }, reason: 'Đóng cửa' },
    });
  });

  it('refuses a Draft', async () => {
    const { place } = await places.createEditorialPlace(createRequest(), staff());
    expect(
      await errorOf(places.deactivatePlace({ placeId: place!.id, reason: 'x' }, staff())),
    ).toEqual({ code: 'INVALID_STATE', details: { status: 'DRAFT' } });
  });
});

describe('DeletePlace and RestorePlace', () => {
  it('soft-deletes and restores with the same status, telling consumers both times', async () => {
    const place = await activePlace();
    const before = await syncVersion(place.id);
    await places.deletePlace({ placeId: place.id }, staff());
    expect(await syncVersion(place.id)).toBeGreaterThan(before);
    const { place: listed } = await places.getPlaceAdmin({ placeId: place.id }, staff());
    expect(listed!.deletedAt).toBeDefined();
    expect((await errorOf(places.deletePlace({ placeId: place.id }, staff()))).code).toBe(
      'INVALID_STATE',
    );
    const { place: restored } = await places.restorePlace({ placeId: place.id }, staff());
    expect(restored).toMatchObject({ status: S.PLACE_STATUS_ACTIVE, deletedAt: undefined });
    expect(await outboxPayloads(prisma, CATALOG_PLACE_STATUS_CHANGED.subject)).toEqual([
      expect.objectContaining({ from: 'ACTIVE', to: 'ACTIVE', deleted: true }),
      expect.objectContaining({ from: 'ACTIVE', to: 'ACTIVE', deleted: false }),
    ]);
    expect(await actions()).toEqual(['PLACE_DELETED', 'PLACE_RESTORED']);
    expect((await errorOf(places.restorePlace({ placeId: place.id }, staff()))).code).toBe(
      'INVALID_STATE',
    );
  });

  it('asks billing before deleting a Venue, failing closed', async () => {
    const venue = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.venueOnly.id,
      kind: PlaceKind.VENUE,
    });
    expect((await errorOf(places.deletePlace({ placeId: venue.id }, staff()))).code).toBe(
      'UPSTREAM_UNAVAILABLE',
    );
    const withVouchers = catalogServices(prisma, {
      billing: { countLiveVouchers: () => Promise.resolve(2) },
    }).places;
    expect((await errorOf(withVouchers.deletePlace({ placeId: venue.id }, staff()))).code).toBe(
      'PLACE_HAS_LIVE_VOUCHERS',
    );
    const clear = catalogServices(prisma, {
      billing: { countLiveVouchers: () => Promise.resolve(0) },
    }).places;
    await clear.deletePlace({ placeId: venue.id }, staff());
    expect(
      (await prisma.place.findUniqueOrThrow({ where: { id: venue.id } })).deletedAt,
    ).not.toBeNull();
  });
});

describe('ListPlaces and GetPlaceAdmin', () => {
  it('pages, filters and searches', async () => {
    const draft = (await places.createEditorialPlace(createRequest(), staff())).place!;
    const live = await activePlace();
    await places.updatePlace(updateRequest(live.id, { nameVi: 'Nhà thờ Đức Bà' }), staff());
    const deleted = await processingPlace();
    await places.deletePlace({ placeId: deleted.id }, staff());
    const page = (overrides: Partial<catalogGrpc.ListPlacesRequest> = {}) =>
      places.listPlaces(
        {
          page: { page: 1, pageSize: 20, sort: '-updatedAt' },
          includeDeleted: false,
          ...overrides,
        },
        staff(),
      );
    const all = await page();
    expect(all.page).toEqual({ page: 1, pageSize: 20, total: 2 });
    expect(all.places.map((row) => row.id)).toEqual([live.id, draft.id]);
    expect((await page({ includeDeleted: true })).page!.total).toBe(3);
    expect(
      (await page({ status: catalogGrpc.PlaceStatus.PLACE_STATUS_DRAFT })).places.map(
        (row) => row.id,
      ),
    ).toEqual([draft.id]);
    // Case-folded, but not accent-folded: that needs `unaccent`, which search brings.
    expect(
      (await page({ page: { page: 1, pageSize: 20, sort: 'nameVi', q: 'đức' } })).places.map(
        (row) => row.id,
      ),
    ).toEqual([live.id]);
    expect(
      (await page({ page: { page: 1, pageSize: 20, sort: 'nameVi', q: 'duc' } })).places,
    ).toEqual([]);
    expect(
      (await page({ page: { page: 1, pageSize: 20, sort: 'nameVi', q: 'Đức Bà' } })).places.map(
        (row) => row.id,
      ),
    ).toEqual([live.id]);
    expect(
      (await page({ page: { page: 1, pageSize: 20, sort: 'nameVi', q: draft.publicCode } })).places,
    ).toHaveLength(1);
    expect((await errorOf(page({ page: { page: 1, pageSize: 20, sort: 'kind' } }))).code).toBe(
      'VALIDATION_FAILED',
    );
    expect((await errorOf(places.getPlaceAdmin({ placeId: newId() }, staff()))).code).toBe(
      'RESOURCE_NOT_FOUND',
    );
  });

  it('shows localization readiness and staleness per language', async () => {
    const place = await processingPlace();
    await insertLocalization(prisma, place.id, 'en', place.contentHash);
    await insertLocalization(prisma, place.id, 'ja', 'f'.repeat(64));
    const { place: detail } = await places.getPlaceAdmin({ placeId: place.id }, staff());
    expect(detail!.localizations).toEqual([
      expect.objectContaining({ lang: 'en', textReady: true, stale: false, audioStale: false }),
      expect.objectContaining({ lang: 'ja', stale: true, audioStale: true }),
    ]);
  });
});

describe('GetPlaceQr', () => {
  it('draws the sticker URL and prints the code', async () => {
    const place = await processingPlace();
    const qr = await places.getPlaceQr(
      { placeId: place.id, qrBaseUrl: 'https://go.wayfare.app/' },
      staff(),
    );
    expect(qr.publicCode).toBe(place.publicCode);
    expect(qr.svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(qr.svg).toContain(`>${place.publicCode}</text>`);
    expect(
      (await errorOf(places.getPlaceQr({ placeId: place.id, qrBaseUrl: 'ftp://x' }, staff()))).code,
    ).toBe('VALIDATION_FAILED');
  });
});
