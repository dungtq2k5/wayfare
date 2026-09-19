// An erased owner's Venues (api-endpoints-plan §10, rdm-spec C-1): the published and waiting ones
// go INACTIVE (OWNER), which nothing lifts, drafts are soft-deleted, and the rows are kept.
import {
  AUDIT_RECORD,
  AuditAction,
  BILLING_ENTITLEMENTS_CHANGED,
  CATALOG_PLACE_STATUS_CHANGED,
  FREE_PLAN_GRANTS,
  IDENTITY_USER_ERASED,
  newId,
  PlaceInactiveReason,
  PlaceKind,
  PlaceStatus,
} from '@wayfare/contracts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';
import { insertPlace, outboxPayloads, taxonomy } from '../setup/fixtures';
import { catalogServices } from '../setup/services';

const prisma = testPrisma();
const { places } = catalogServices(prisma);
const CONSUMER = 'catalog-identity-user-erased';
let tax: Awaited<ReturnType<typeof taxonomy>>;
let ownerUserId: string;

beforeEach(async () => {
  await truncateAll(prisma);
  tax = await taxonomy(prisma);
  ownerUserId = newId();
});
afterAll(() => prisma.$disconnect());

const venue = (status: PlaceStatus, owner = ownerUserId) =>
  insertPlace(prisma, {
    areaId: tax.area.id,
    categoryId: tax.venueOnly.id,
    kind: PlaceKind.VENUE,
    status,
    ownerUserId: owner,
  });

const erased = (userId = ownerUserId) =>
  IDENTITY_USER_ERASED.schema.parse({
    eventId: newId(),
    occurredAt: new Date().toISOString(),
    userId,
  });

const row = (id: string) => prisma.place.findUniqueOrThrow({ where: { id } });

describe('identity.user.erased', () => {
  it('retires every Venue of the owner, and nobody else’s', async () => {
    const active = await venue(PlaceStatus.ACTIVE);
    const processing = await venue(PlaceStatus.PROCESSING);
    const draft = await venue(PlaceStatus.DRAFT);
    const limited = await venue(PlaceStatus.INACTIVE);
    await prisma.place.update({
      where: { id: limited.id },
      data: { inactiveReason: PlaceInactiveReason.ENTITLEMENT_LIMIT },
    });
    const byAdmin = await venue(PlaceStatus.INACTIVE);
    const other = await venue(PlaceStatus.ACTIVE, newId());
    const syncBefore = (await row(active.id)).syncVersion;

    await places.retireErasedOwner(erased(), CONSUMER);

    for (const { id } of [active, processing, limited, byAdmin]) {
      expect(await row(id)).toMatchObject({
        status: PlaceStatus.INACTIVE,
        inactiveReason: PlaceInactiveReason.OWNER,
        deletedAt: null,
      });
    }
    expect((await row(draft.id)).deletedAt).not.toBeNull();
    expect((await row(draft.id)).status).toBe(PlaceStatus.DRAFT);
    expect((await row(other.id)).status).toBe(PlaceStatus.ACTIVE);
    // Off the map at the next sync.
    expect((await row(active.id)).syncVersion).toBeGreaterThan(syncBefore);

    const changes = await outboxPayloads(prisma, CATALOG_PLACE_STATUS_CHANGED.subject);
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ placeId: active.id, to: PlaceStatus.INACTIVE, reason: 'OWNER' }),
        expect.objectContaining({ placeId: draft.id, deleted: true }),
      ]),
    );
    expect(changes.filter((change) => change.placeId === limited.id)).toEqual([]);
    const audits = (await outboxPayloads(prisma, AUDIT_RECORD.subject)).filter(
      (payload) => (payload.actor as { type: string }).type === 'SYSTEM',
    );
    expect(audits.filter((audit) => audit.action === AuditAction.PLACE_DEACTIVATED)).toHaveLength(
      4,
    );
    expect(audits.filter((audit) => audit.action === AuditAction.PLACE_DELETED)).toHaveLength(1);
  });

  it('is applied once, and a grant widening afterwards brings nothing back', async () => {
    const active = await venue(PlaceStatus.ACTIVE);
    const payload = erased();
    await places.retireErasedOwner(payload, CONSUMER);
    const audits = await prisma.outboxEvent.count();
    await places.retireErasedOwner(payload, CONSUMER);
    await places.retireErasedOwner(erased(), CONSUMER);
    expect(await prisma.outboxEvent.count()).toBe(audits);

    await places.applyEntitlements(
      BILLING_ENTITLEMENTS_CHANGED.schema.parse({
        eventId: newId(),
        occurredAt: new Date().toISOString(),
        ownerUserId,
        entitlementsVersion: 2,
        entitlements: { ...FREE_PLAN_GRANTS, maxPlaces: 10 },
        previous: FREE_PLAN_GRANTS,
      }),
    );
    expect(await row(active.id)).toMatchObject({
      status: PlaceStatus.INACTIVE,
      inactiveReason: PlaceInactiveReason.OWNER,
    });
  });
});
