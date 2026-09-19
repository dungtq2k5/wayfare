// An owner's Venues follow billing's grants (api-endpoints-plan §10, rdm-spec B-3, C-1, C-18):
// auto-narration, the place limit both ways through catalog's system paths, newly covered
// languages, and the version guard kept in `owner_entitlements`.
import {
  AnalyticsLevel,
  AUDIT_RECORD,
  AuditAction,
  BILLING_ENTITLEMENTS_CHANGED,
  CATALOG_PLACE_CONTENT_CHANGED,
  CATALOG_PLACE_STATUS_CHANGED,
  FREE_PLAN_GRANTS,
  NarrationLanguageScope,
  newId,
  PlaceInactiveReason,
  PlaceKind,
  PlaceStatus,
  SynthesisTrigger,
} from '@wayfare/contracts';
import type { Entitlements, EventPayload } from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';
import {
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
const { places, ownerEntitlements } = catalogServices(prisma);
let tax: Awaited<ReturnType<typeof taxonomy>>;
let ownerUserId: string;

const GROWTH: Entitlements = {
  maxPlaces: 10,
  autoNarration: true,
  narrationLanguageScope: NarrationLanguageScope.LAUNCH,
  maxPhotosPerPlace: 8,
  maxMenuItemsPerPlace: 200,
  discoveryBoostSlots: 1,
  aiCreditsPerDay: 10,
  analyticsLevel: AnalyticsLevel.BASIC,
  canSellVouchers: true,
  voucherCommissionBps: 1500,
};

beforeEach(async () => {
  await truncateAll(prisma);
  tax = await taxonomy(prisma);
  ownerUserId = newId();
});
afterAll(() => prisma.$disconnect());

const changed = (
  version: number,
  entitlements: Entitlements,
  previous: Entitlements | null,
): EventPayload<typeof BILLING_ENTITLEMENTS_CHANGED> =>
  BILLING_ENTITLEMENTS_CHANGED.schema.parse({
    eventId: newId(),
    occurredAt: new Date().toISOString(),
    ownerUserId,
    entitlementsVersion: version,
    entitlements,
    previous,
  });

const venue = (status: PlaceStatus, minutesAgo: number, over: { autoNarration?: boolean } = {}) =>
  insertPlace(prisma, {
    areaId: tax.area.id,
    categoryId: tax.venueOnly.id,
    kind: PlaceKind.VENUE,
    status,
    ownerUserId,
    autoNarrationEnabled: over.autoNarration ?? false,
    createdAt: new Date(Date.now() - minutesAgo * 60_000),
  });

const row = (id: string) =>
  prisma.place.findUniqueOrThrow({
    where: { id },
    select: { status: true, inactiveReason: true, autoNarrationEnabled: true, syncVersion: true },
  });

describe('billing.entitlements.changed', () => {
  it('turns auto-narration on for every Venue of the owner, bumping each', async () => {
    const a = await venue(PlaceStatus.ACTIVE, 30);
    const b = await venue(PlaceStatus.DRAFT, 20);
    const before = await row(a.id);
    await places.applyEntitlements(changed(1, FREE_PLAN_GRANTS, null));
    await places.applyEntitlements(changed(2, GROWTH, FREE_PLAN_GRANTS));
    for (const id of [a.id, b.id]) expect((await row(id)).autoNarrationEnabled).toBe(true);
    expect((await row(a.id)).syncVersion).toBeGreaterThan(before.syncVersion);
    expect(await ownerEntitlements.current(prisma, ownerUserId)).toMatchObject({
      version: 2,
      autoNarration: true,
      narrationLanguageScope: NarrationLanguageScope.LAUNCH,
      maxPlaces: 10,
    });
  });

  it('unpublishes the newest live Venue beyond the limit, then brings it back', async () => {
    const oldest = await venue(PlaceStatus.ACTIVE, 30, { autoNarration: true });
    const newer = await venue(PlaceStatus.ACTIVE, 20, { autoNarration: true });
    const draft = await venue(PlaceStatus.DRAFT, 10, { autoNarration: true });
    await places.applyEntitlements(changed(2, GROWTH, FREE_PLAN_GRANTS));
    await places.applyEntitlements(changed(3, FREE_PLAN_GRANTS, GROWTH));

    expect(await row(oldest.id)).toMatchObject({
      status: PlaceStatus.ACTIVE,
      autoNarrationEnabled: false,
    });
    expect(await row(newer.id)).toMatchObject({
      status: PlaceStatus.INACTIVE,
      inactiveReason: PlaceInactiveReason.ENTITLEMENT_LIMIT,
    });
    // A Draft counts, but was never published: it is not unpublished.
    expect((await row(draft.id)).status).toBe(PlaceStatus.DRAFT);
    expect(await outboxPayloads(prisma, CATALOG_PLACE_STATUS_CHANGED.subject)).toEqual([
      expect.objectContaining({
        placeId: newer.id,
        from: PlaceStatus.ACTIVE,
        to: PlaceStatus.INACTIVE,
        reason: PlaceInactiveReason.ENTITLEMENT_LIMIT,
        ownerUserId,
      }),
    ]);
    const deactivated = (await outboxPayloads(prisma, AUDIT_RECORD.subject)).filter(
      (payload) => payload.action === AuditAction.PLACE_DEACTIVATED,
    );
    expect(deactivated).toEqual([
      expect.objectContaining({
        actor: { type: 'SYSTEM' },
        resource: { type: 'PLACE', id: newer.id },
      }),
    ]);

    // Only a wider plan lifts ENTITLEMENT_LIMIT: an admin's activation is refused.
    expect((await errorOf(places.requestActivation({ placeId: newer.id }, staff()))).code).toBe(
      'INVALID_STATE',
    );

    await insertLocalization(prisma, newer.id, 'en', newer.contentHash);
    await places.applyEntitlements(changed(4, GROWTH, FREE_PLAN_GRANTS));
    expect(await row(newer.id)).toMatchObject({ status: PlaceStatus.ACTIVE, inactiveReason: null });
    expect(
      (await outboxPayloads(prisma, CATALOG_PLACE_STATUS_CHANGED.subject)).at(-1),
    ).toMatchObject({
      placeId: newer.id,
      from: PlaceStatus.INACTIVE,
      to: PlaceStatus.ACTIVE,
    });
  });

  it('ignores a version not newer than the projection', async () => {
    const a = await venue(PlaceStatus.ACTIVE, 30);
    await places.applyEntitlements(changed(5, GROWTH, FREE_PLAN_GRANTS));
    await places.applyEntitlements(changed(4, FREE_PLAN_GRANTS, GROWTH));
    await places.applyEntitlements(changed(5, FREE_PLAN_GRANTS, GROWTH));
    expect((await row(a.id)).autoNarrationEnabled).toBe(true);
    expect((await ownerEntitlements.current(prisma, ownerUserId))?.version).toBe(5);
  });

  it('asks narration for newly covered languages, and later edits ask for the whole scope', async () => {
    const live = await venue(PlaceStatus.ACTIVE, 30);
    await venue(PlaceStatus.DRAFT, 20);
    await places.applyEntitlements(changed(1, FREE_PLAN_GRANTS, null));
    await places.applyEntitlements(changed(2, GROWTH, FREE_PLAN_GRANTS));
    expect(await outboxPayloads(prisma, CATALOG_PLACE_CONTENT_CHANGED.subject)).toEqual([
      expect.objectContaining({
        placeId: live.id,
        contentHash: live.contentHash,
        langs: ['zh-Hans', 'ja', 'ko'],
        trigger: SynthesisTrigger.ENTITLEMENT_EXPANDED,
      }),
    ]);

    await places.updatePlace(updateRequest(live.id, { descriptionVi: 'Một mô tả mới.' }), staff());
    expect(
      (await outboxPayloads(prisma, CATALOG_PLACE_CONTENT_CHANGED.subject)).at(-1),
    ).toMatchObject({
      placeId: live.id,
      langs: ['vi', 'en', 'zh-Hans', 'ja', 'ko'],
      trigger: SynthesisTrigger.CONTENT_CHANGED,
    });
  });

  it("asks a Venue's basic scope before any grant arrived", async () => {
    const live = await venue(PlaceStatus.ACTIVE, 30);
    await places.updatePlace(updateRequest(live.id, { descriptionVi: 'Một mô tả khác.' }), staff());
    expect(
      (await outboxPayloads(prisma, CATALOG_PLACE_CONTENT_CHANGED.subject)).at(-1),
    ).toMatchObject({
      langs: ['vi', 'en'],
    });
  });
});

describe('CountOwnerPlaces', () => {
  it('counts the Venues in PLACE_LIMIT_STATUSES, never INACTIVE or deleted ones', async () => {
    const { sources } = catalogServices(prisma);
    await venue(PlaceStatus.DRAFT, 50);
    await venue(PlaceStatus.PROCESSING, 40);
    await venue(PlaceStatus.ACTIVE, 30);
    await venue(PlaceStatus.INACTIVE, 20);
    await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.venueOnly.id,
      kind: PlaceKind.VENUE,
      ownerUserId,
      deleted: true,
    });
    expect(await sources.countOwnerPlaces({ ownerUserId })).toEqual({ count: 3 });
  });
});
