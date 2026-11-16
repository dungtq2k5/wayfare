// The taxonomy's administration (api-endpoints-plan §3.6, rdm-spec C-1 to C-3): categories and areas
// with their counts and audit rows, the area refusals, codes that never change, taxonomy changes
// that never touch existing Places, and Place and area writes that never interleave.
import {
  AUDIT_RECORD,
  AuditAction,
  CategoryAppliesTo,
  MenuCurrency,
  PlaceKind,
  PlaceStatus,
  SubmissionKind,
} from '@wayfare/contracts';
import type { PlaceSubmissionPayload } from '@wayfare/contracts';
import { categoryAppliesToProto, submissionKindProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { FIXTURE_INSIDE } from '@wayfare/contracts/testing';
import type { AccountContext } from '@wayfare/nest-common';
import { buildAccountContext } from '@wayfare/nest-common/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';
import {
  createRequest,
  errorOf,
  insertPlace,
  outboxPayloads,
  staff,
  taxonomy,
  updateRequest,
} from '../setup/fixtures';
import { catalogServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof catalogServices>;
let tax: Awaited<ReturnType<typeof taxonomy>>;
let owner: AccountContext;
const admin = (): AccountContext =>
  buildAccountContext({ permissions: ['catalog.taxonomy.manage'] });
const moderator = () =>
  buildAccountContext({ permissions: ['submission.read', 'submission.review'] });

beforeEach(async () => {
  await truncateAll(prisma);
  services = catalogServices(prisma);
  tax = await taxonomy(prisma);
  owner = buildAccountContext({ ownerVerified: true, permissions: ['owner.access'] });
});
afterAll(async () => {
  await truncateAll(prisma);
  await prisma.$disconnect();
});

type Ring = readonly (readonly [number, number])[];
const polygon = (ring: Ring) => JSON.stringify({ type: 'Polygon', coordinates: [ring] });
const box = (west: number, south: number, east: number, north: number): Ring => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south],
];
/** Clear of the fixture area (lng 106.69–106.71, lat 10.765–10.78). */
const ELSEWHERE = box(106.73, 10.765, 106.74, 10.775);
/** The fixture area's south-west corner, still covering its center, without Bến Thành. */
const SHRUNK = box(106.69, 10.765, 106.695, 10.77);

const audits = async (action: AuditAction) =>
  (await outboxPayloads(prisma, AUDIT_RECORD.subject)).filter((row) => row.action === action);

const createArea = (over: Partial<catalogGrpc.CreateAreaRequest> = {}) =>
  services.taxonomy.createArea(
    {
      code: 'walk-d3',
      nameVi: 'Khu thử',
      boundaryGeojson: polygon(ELSEWHERE),
      center: { lat: 10.77, lng: 106.735 },
      defaultZoom: 16,
      sortOrder: 5,
      isActive: true,
      ...over,
    },
    admin(),
  );

const updateArea = (areaId: string, over: Partial<catalogGrpc.UpdateAreaRequest>) =>
  services.taxonomy.updateArea({ areaId, center: undefined, ...over }, admin());

const categoryOf = async (code: string) =>
  (await services.taxonomy.listAdminCategories(admin())).categories.find((c) => c.code === code)!;

function payload(over: Partial<PlaceSubmissionPayload> = {}): PlaceSubmissionPayload {
  return {
    nameVi: 'Quán Bún Chả',
    descriptionVi: 'Bún chả Hà Nội.',
    categoryCode: 'RESTAURANT',
    location: FIXTURE_INSIDE,
    addressVi: '12 Lê Lợi',
    priceBand: 2,
    phone: '+84901234567',
    websiteUrl: null,
    openingHours: [],
    photos: [],
    menu: { menuCurrency: MenuCurrency.VND, items: [] },
    ...over,
  };
}

const submit = (kind: SubmissionKind, body: PlaceSubmissionPayload, extra = {}) =>
  services.submissions.createSubmission(
    {
      kind: submissionKindProto.toProto(kind),
      payloadJson: JSON.stringify(body),
      ...extra,
    },
    owner,
  );

const approve = (submissionId: string) =>
  services.review.approveSubmission(
    { submissionId, triggerRadiusM: 30, narrationPriority: 60, acknowledgeConflict: false },
    moderator(),
  );

/** A live Venue of the owner, made the ordinary way. */
async function liveVenue(): Promise<string> {
  const { submission } = await submit(SubmissionKind.CREATE, payload());
  const { submission: approved } = await approve(submission!.id);
  return approved!.placeId!;
}

describe('categories', () => {
  it('lists every category with its Place count, creates one, and refuses a taken code', async () => {
    await insertPlace(prisma, { areaId: tax.area.id, categoryId: tax.any.id });
    await insertPlace(prisma, { areaId: tax.area.id, categoryId: tax.any.id, deleted: true });
    expect(await categoryOf('MARKET')).toMatchObject({ placeCount: 1, isActive: true });

    const { category } = await services.taxonomy.createCategory(
      {
        code: 'TEST_BAKERY',
        appliesTo: categoryAppliesToProto.toProto(CategoryAppliesTo.VENUE),
        icon: 'bakery',
        sortOrder: 110,
      },
      admin(),
    );
    expect(category).toMatchObject({ code: 'TEST_BAKERY', placeCount: 0, isActive: true });
    expect(await audits(AuditAction.CATEGORY_CREATED)).toEqual([
      expect.objectContaining({
        resource: { type: 'CATEGORY', id: category!.id },
        metadata: {
          after: { code: 'TEST_BAKERY', appliesTo: 'VENUE', icon: 'bakery', sortOrder: 110 },
        },
      }),
    ]);
    const taken = await errorOf(
      services.taxonomy.createCategory(
        { code: 'TEST_BAKERY', appliesTo: 2, icon: 'bakery', sortOrder: 1 },
        admin(),
      ),
    );
    expect(taken).toEqual({
      code: 'VALIDATION_FAILED',
      details: { issues: [{ path: '/code', code: 'taken' }] },
    });
    for (const [request, path] of [
      [{ code: 'bakery', appliesTo: 2, icon: 'bakery', sortOrder: 1 }, '/code'],
      [{ code: 'TEST_X', appliesTo: 0, icon: 'bakery', sortOrder: 1 }, '/appliesTo'],
      [{ code: 'TEST_X', appliesTo: 2, icon: 'Bakery!', sortOrder: 1 }, '/icon'],
    ] as const) {
      const failure = await errorOf(services.taxonomy.createCategory(request, admin()));
      expect(failure.details, path).toMatchObject({ issues: [expect.objectContaining({ path })] });
    }
  });

  it('changes the fields sent, audits once, and writes nothing for an unchanged edit', async () => {
    const market = await categoryOf('MARKET');
    const { category } = await services.taxonomy.updateCategory(
      { categoryId: market.id, icon: 'market-2', sortOrder: 45 },
      admin(),
    );
    expect(category).toMatchObject({ code: 'MARKET', icon: 'market-2', sortOrder: 45 });
    await services.taxonomy.updateCategory(
      { categoryId: market.id, icon: 'market-2', sortOrder: 45, isActive: true },
      admin(),
    );
    expect(await audits(AuditAction.CATEGORY_UPDATED)).toEqual([
      expect.objectContaining({
        metadata: {
          before: { icon: 'market', sortOrder: 40 },
          after: { icon: 'market-2', sortOrder: 45 },
        },
      }),
    ]);
    expect(
      (await errorOf(services.taxonomy.updateCategory({ categoryId: tax.area.id }, admin()))).code,
    ).toBe('RESOURCE_NOT_FOUND');
  });

  it('takes a deactivated category out of new choices while its Places keep it', async () => {
    const kept = await insertPlace(prisma, { areaId: tax.area.id, categoryId: tax.any.id });
    const market = await categoryOf('MARKET');
    await services.taxonomy.updateCategory({ categoryId: market.id, isActive: false }, admin());

    expect((await prisma.place.findUniqueOrThrow({ where: { id: kept.id } })).categoryId).toBe(
      tax.any.id,
    );
    expect(
      (await services.queries.listCategories({}, admin())).categories.map((c) => c.code),
    ).not.toContain('MARKET');
    expect(await errorOf(services.places.createEditorialPlace(createRequest(), staff()))).toEqual({
      code: 'RESOURCE_NOT_FOUND',
      details: { resource: 'CATEGORY' },
    });
    // An edit of the Place that keeps its category is not refused.
    await services.places.updatePlace(
      updateRequest(kept.id, { categoryCode: 'MARKET', addressVi: '1 Lê Lợi' }),
      staff(),
    );
    await services.taxonomy.updateCategory({ categoryId: market.id, isActive: true }, admin());
    expect((await categoryOf('MARKET')).placeCount).toBe(1);
  });
});

describe('a Venue whose category changed after it was chosen', () => {
  it.each([
    ['deactivated', { isActive: false }, 'RESOURCE_NOT_FOUND'],
    ['narrowed to Editorial Places', { appliesTo: 1 }, 'CATEGORY_NOT_APPLICABLE'],
  ] as const)(
    'is %s, and its owner and an admin still edit it',
    async (_label, change, refusal) => {
      const placeId = await liveVenue();
      const other = await liveVenue();
      await services.places.updatePlace(
        updateRequest(other, { categoryCode: 'STREET_FOOD' }),
        staff(),
      );
      const restaurant = await categoryOf('RESTAURANT');
      await services.taxonomy.updateCategory({ categoryId: restaurant.id, ...change }, admin());

      // The owner's phone-only edit, submitted and approved.
      const detail = await services.ownerPlaces.getMyPlace({ placeId }, owner);
      const { submission } = await submit(
        SubmissionKind.UPDATE,
        payload({ phone: '+84907654321' }),
        {
          placeId,
          baseEditableHash: detail.editableHash,
        },
      );
      await approve(submission!.id);
      expect(await prisma.place.findUniqueOrThrow({ where: { id: placeId } })).toMatchObject({
        phone: '+84907654321',
        categoryId: restaurant.id,
      });
      // An admin's edit re-sending the category.
      await services.places.updatePlace(
        updateRequest(placeId, { categoryCode: 'RESTAURANT', phone: '+84900000001' }),
        staff(),
      );
      expect((await prisma.place.findUniqueOrThrow({ where: { id: placeId } })).phone).toBe(
        '+84900000001',
      );

      // Choosing it anew is still refused, by the owner and by an admin.
      const again = await services.ownerPlaces.getMyPlace({ placeId: other }, owner);
      expect(
        (
          await errorOf(
            submit(SubmissionKind.UPDATE, payload(), {
              placeId: other,
              baseEditableHash: again.editableHash,
            }),
          )
        ).code,
      ).toBe(refusal);
      expect(
        (
          await errorOf(
            services.places.updatePlace(
              updateRequest(other, { categoryCode: 'RESTAURANT' }),
              staff(),
            ),
          )
        ).code,
      ).toBe(refusal);
    },
  );
});

describe('areas', () => {
  it('lists every area with its Places by status, creates one, and refuses an overlap', async () => {
    await insertPlace(prisma, { areaId: tax.area.id, categoryId: tax.any.id });
    await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.any.id,
      status: PlaceStatus.DRAFT,
    });
    const { area } = await createArea();
    expect(area).toMatchObject({
      code: 'walk-d3',
      isActive: true,
      placeCounts: { draft: 0, processing: 0, active: 0, inactive: 0 },
    });
    expect(JSON.parse(area!.boundaryGeojson)).toEqual({
      type: 'Polygon',
      coordinates: [ELSEWHERE],
    });
    const listed = (await services.taxonomy.listAdminAreas(admin())).areas;
    expect(listed.find((row) => row.id === tax.area.id)!.placeCounts).toEqual({
      draft: 1,
      processing: 0,
      active: 1,
      inactive: 0,
    });
    expect(await audits(AuditAction.AREA_CREATED)).toEqual([
      expect.objectContaining({
        resource: { type: 'AREA', id: area!.id },
        metadata: {
          after: {
            code: 'walk-d3',
            nameVi: 'Khu thử',
            defaultZoom: 16,
            sortOrder: 5,
            isActive: true,
          },
        },
      }),
    ]);

    expect(await errorOf(createArea({ code: 'walk-d3' }))).toEqual({
      code: 'VALIDATION_FAILED',
      details: { issues: [{ path: '/code', code: 'taken' }] },
    });
    expect(
      await errorOf(
        createArea({
          code: 'overlapping',
          boundaryGeojson: polygon(box(106.7, 10.77, 106.72, 10.79)),
          center: { lat: 10.78, lng: 106.715 },
        }),
      ),
    ).toEqual({ code: 'AREA_OVERLAPS', details: { codes: [tax.area.code] } });
    // An inactive area may overlap; activating it is checked.
    const { area: idle } = await createArea({
      code: 'idle',
      boundaryGeojson: polygon(box(106.7, 10.77, 106.72, 10.79)),
      center: { lat: 10.78, lng: 106.715 },
      isActive: false,
    });
    expect((await errorOf(updateArea(idle!.id, { isActive: true }))).code).toBe('AREA_OVERLAPS');
  });

  it('refuses a boundary that leaves a Place outside, and moves one that does not', async () => {
    const inside = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.any.id,
      status: PlaceStatus.INACTIVE,
    });
    expect(await errorOf(updateArea(tax.area.id, { boundaryGeojson: polygon(SHRUNK) }))).toEqual({
      code: 'AREA_EXCLUDES_PLACES',
      details: { count: 1, placeIds: [inside.id] },
    });
    const wider = box(106.685, 10.76, 106.715, 10.785);
    const { area } = await updateArea(tax.area.id, {
      boundaryGeojson: polygon(wider),
      nameVi: 'Khu rộng',
    });
    expect(JSON.parse(area!.boundaryGeojson)).toEqual({ type: 'Polygon', coordinates: [wider] });
    await updateArea(tax.area.id, { boundaryGeojson: polygon(wider), nameVi: 'Khu rộng' });
    expect(await audits(AuditAction.AREA_UPDATED)).toEqual([
      expect.objectContaining({
        metadata: {
          before: { nameVi: `Khu ${tax.area.code}` },
          after: { nameVi: 'Khu rộng', boundaryChanged: true, centerChanged: false },
        },
      }),
    ]);
  });

  it('refuses to deactivate an area with live Places, and takes no Place live in an inactive one', async () => {
    await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.any.id,
      status: PlaceStatus.PROCESSING,
    });
    await insertPlace(prisma, { areaId: tax.area.id, categoryId: tax.any.id });
    expect(await errorOf(updateArea(tax.area.id, { isActive: false }))).toEqual({
      code: 'AREA_HAS_LIVE_PLACES',
      details: { count: 2 },
    });

    const { area } = await createArea();
    const inactive = await insertPlace(prisma, {
      areaId: area!.id,
      categoryId: tax.any.id,
      status: PlaceStatus.INACTIVE,
      location: { lat: 10.77, lng: 106.735 },
    });
    const deleted = await insertPlace(prisma, {
      areaId: area!.id,
      categoryId: tax.any.id,
      status: PlaceStatus.DRAFT,
      location: { lat: 10.771, lng: 106.736 },
      deleted: true,
    });
    const venue = await insertPlace(prisma, {
      areaId: area!.id,
      categoryId: tax.venueOnly.id,
      kind: PlaceKind.VENUE,
      ownerUserId: owner.userId,
      location: { lat: 10.772, lng: 106.737 },
    });
    await services.ownerPlaces.deactivateMyPlace({ placeId: venue.id }, owner);
    const { area: off } = await updateArea(area!.id, { isActive: false });
    expect(off).toMatchObject({ isActive: false, placeCounts: { inactive: 2 } });
    expect((await services.queries.listAreas({}, admin())).areas.map((a) => a.code)).not.toContain(
      'walk-d3',
    );

    for (const call of [
      () => services.places.requestActivation({ placeId: inactive.id }, staff()),
      () => services.places.restorePlace({ placeId: deleted.id }, staff()),
      () => services.ownerPlaces.reactivateMyPlace({ placeId: venue.id }, owner),
    ]) {
      expect((await errorOf(call())).code).toBe('AREA_INACTIVE');
    }
  });

  it('validates the shape, the center, the zoom and the code at their fields', async () => {
    const cases: [Partial<catalogGrpc.CreateAreaRequest>, string, string][] = [
      [
        {
          boundaryGeojson: polygon([
            [106.73, 10.765],
            [106.74, 10.775],
            [106.74, 10.765],
            [106.73, 10.775],
            [106.73, 10.765],
          ]),
        },
        '/boundary',
        'invalid_polygon',
      ],
      [{ boundaryGeojson: polygon(ELSEWHERE.slice(0, 4)) }, '/boundary/coordinates/0', 'custom'],
      [
        {
          boundaryGeojson: polygon([
            ...Array.from({ length: 501 }, (_, i) => [106.73 + i * 0.00001, 10.765] as const),
            [106.735, 10.775],
            [106.73, 10.765],
          ]),
        },
        '/boundary/coordinates/0',
        'too_big',
      ],
      [{ boundaryGeojson: '{not json' }, '/boundary', 'invalid_type'],
      [{ center: { lat: 10.8, lng: 106.8 } }, '/center', 'center_outside_boundary'],
      [{ defaultZoom: 19 }, '/defaultZoom', 'too_big'],
      [{ defaultZoom: 9 }, '/defaultZoom', 'too_small'],
      [{ code: 'Walk_D3' }, '/code', 'invalid_format'],
      [{ code: 'a'.repeat(33) }, '/code', 'too_big'],
    ];
    for (const [over, path, code] of cases) {
      expect((await errorOf(createArea(over))).details, path).toEqual({ issues: [{ path, code }] });
    }
    // A boundary-only edit that leaves the stored center outside names the boundary.
    const { area } = await createArea();
    expect(
      (
        await errorOf(
          updateArea(area!.id, { boundaryGeojson: polygon(box(106.736, 10.765, 106.74, 10.775)) }),
        )
      ).details,
    ).toEqual({ issues: [{ path: '/boundary', code: 'center_outside_boundary' }] });
    expect(
      (await errorOf(updateArea(area!.id, { center: { lat: 10.8, lng: 106.8 } }))).details,
    ).toEqual({ issues: [{ path: '/center', code: 'center_outside_boundary' }] });
    expect(await audits(AuditAction.AREA_UPDATED)).toEqual([]);
  });
});

/** A call's outcome: `ok`, or the error code it was refused with. */
const settle = (call: Promise<unknown>): Promise<string> =>
  call.then(
    () => 'ok',
    (error: unknown) => {
      const rpc = error as { getError?: () => { metadata: { get(key: string): unknown[] } } };
      if (typeof rpc.getError !== 'function') throw error;
      return String(rpc.getError().metadata.get('wf-error-code')[0]);
    },
  );

describe('a Place write and an area write at once', () => {
  it.each([
    ['deactivates', { isActive: false }, 'AREA_HAS_LIVE_PLACES'],
    ['shrinks', { boundaryGeojson: polygon(SHRUNK) }, 'AREA_EXCLUDES_PLACES'],
  ] as const)(
    'never land a Venue outside or in an inactive area while an admin %s it',
    async (_label, change, refusal) => {
      for (let round = 0; round < 4; round += 1) {
        await truncateAll(prisma);
        services = catalogServices(prisma);
        tax = await taxonomy(prisma);
        const { submission } = await submit(SubmissionKind.CREATE, payload());
        const [approval, area] = await Promise.all([
          settle(approve(submission!.id)),
          settle(updateArea(tax.area.id, change)),
        ]);
        // Exactly one of the two wins; the other is refused for what the winner did.
        expect(
          [
            ['ok', refusal],
            ['LOCATION_OUTSIDE_AREAS', 'ok'],
          ],
          `round ${round}`,
        ).toContainEqual([approval, area]);
        const stranded = await prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id FROM places p JOIN areas a ON a.id = p.area_id
        WHERE p.deleted_at IS NULL AND (NOT a.is_active OR NOT ST_Covers(a.boundary, p.location))`;
        expect(stranded).toEqual([]);
      }
    },
  );
});
