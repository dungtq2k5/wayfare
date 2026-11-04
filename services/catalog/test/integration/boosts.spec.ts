// Discovery boosts in catalog (rdm-spec C-1, ADR 0007): `billing.boosts.changed` applied in order
// to the ranking column and nowhere else; the Places billing checks before a boost write; the
// admin list's flag; and the firewall — a boosted Venue's sync record and offline manifest are
// byte-identical to its unboosted self, so the boost can't reach a device, nor its narration.
import { createHash } from 'node:crypto';
import {
  BILLING_BOOSTS_CHANGED,
  DISCOVERY_BOOST_WEIGHT,
  newId,
  PlaceKind,
  PlaceStatus,
} from '@wayfare/contracts';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { BoostsChangedConsumer } from '../../src/modules/boosts-changed/boosts-changed.consumer';
import { bumpSyncVersion } from '../../src/modules/sync/sync.service';
import { testPrisma, truncateAll } from '../setup/database';
import { device, insertLocalization, insertPlace, staff, taxonomy } from '../setup/fixtures';
import { catalogServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof catalogServices>;
let tax: Awaited<ReturnType<typeof taxonomy>>;
let consumer: BoostsChangedConsumer;

beforeEach(async () => {
  await truncateAll(prisma);
  services = catalogServices(prisma);
  tax = await taxonomy(prisma);
  consumer = new BoostsChangedConsumer(prisma);
});
afterAll(() => prisma.$disconnect());

const venue = (overrides: Partial<Parameters<typeof insertPlace>[1]> = {}) =>
  insertPlace(prisma, {
    areaId: tax.area.id,
    categoryId: tax.any.id,
    kind: PlaceKind.VENUE,
    status: PlaceStatus.ACTIVE,
    ...overrides,
  });

const changed = (placeId: string, discoveryBoost: number, changedAt: string) =>
  BILLING_BOOSTS_CHANGED.schema.parse({
    eventId: newId(),
    occurredAt: changedAt,
    placeId,
    discoveryBoost,
    changedAt,
  });

const boostOf = async (placeId: string) =>
  (
    await prisma.place.findUniqueOrThrow({
      where: { id: placeId },
      select: { discoveryBoost: true },
    })
  ).discoveryBoost;

describe('billing.boosts.changed', () => {
  it('sets the weight, idempotently', async () => {
    const place = await venue();
    const event = changed(place.id, DISCOVERY_BOOST_WEIGHT, '2026-11-04T09:00:00.000Z');
    await consumer.handle(event);
    await consumer.handle(event);
    expect(await boostOf(place.id)).toBe(DISCOVERY_BOOST_WEIGHT);
  });

  it('ignores an older change arriving after a newer one', async () => {
    const place = await venue();
    await consumer.handle(changed(place.id, DISCOVERY_BOOST_WEIGHT, '2026-11-04T09:01:00.000Z'));
    // The end of an earlier boost, delivered late: the newer start stands.
    await consumer.handle(changed(place.id, 0, '2026-11-04T09:00:00.000Z'));
    expect(await boostOf(place.id)).toBe(DISCOVERY_BOOST_WEIGHT);
    await consumer.handle(changed(place.id, 0, '2026-11-04T09:02:00.000Z'));
    expect(await boostOf(place.id)).toBe(0);
  });

  it('leaves an Editorial or a deleted Place alone', async () => {
    const editorial = await insertPlace(prisma, {
      areaId: tax.area.id,
      categoryId: tax.any.id,
      kind: PlaceKind.EDITORIAL,
    });
    const deleted = await venue({ deleted: true });
    await consumer.handle(changed(editorial.id, 50, '2026-11-04T09:00:00.000Z'));
    await consumer.handle(changed(deleted.id, 50, '2026-11-04T09:00:00.000Z'));
    expect(await boostOf(editorial.id)).toBe(0);
    expect(await boostOf(deleted.id)).toBe(0);
    // The column's own check refuses an Editorial boost besides.
    await expect(
      prisma.$executeRaw`UPDATE places SET discovery_boost = 50 WHERE id = ${editorial.id}::uuid`,
    ).rejects.toThrow();
  });
});

describe('BatchGetPlaceSummaries', () => {
  it('answers kind, owner and status; unknown and deleted ids are absent', async () => {
    const ownerUserId = newId();
    const live = await venue({ ownerUserId });
    const closed = await venue({ ownerUserId, status: PlaceStatus.INACTIVE });
    const deleted = await venue({ ownerUserId, deleted: true });
    const { places } = await services.sources.batchGetPlaceSummaries({
      placeIds: [live.id, closed.id, deleted.id, newId()],
    });
    const byId = new Map(places.map((place) => [place.id, place]));
    expect(byId.size).toBe(2);
    expect(byId.get(live.id)).toMatchObject({
      ownerUserId,
      status: catalogGrpc.PlaceStatus.PLACE_STATUS_ACTIVE,
    });
    expect(byId.get(closed.id)).toMatchObject({
      ownerUserId,
      status: catalogGrpc.PlaceStatus.PLACE_STATUS_INACTIVE,
    });
    expect(places.every((place) => place.kind === catalogGrpc.PlaceKind.PLACE_KIND_VENUE)).toBe(
      true,
    );
  });
});

describe("the admin list's flag", () => {
  it('marks a boosted row', async () => {
    const boosted = await venue();
    await venue();
    await consumer.handle(changed(boosted.id, 50, '2026-11-04T09:00:00.000Z'));
    const { places } = await services.places.listPlaces(
      {
        page: { page: 1, pageSize: 20, sort: 'statusChangedAt' },
        includeDeleted: false,
        processingBefore: undefined,
      },
      staff(),
    );
    expect(places.find((row) => row.id === boosted.id)?.boosted).toBe(true);
    expect(places.filter((row) => row.boosted)).toHaveLength(1);
  });
});

describe('the firewall (ADR 0007)', () => {
  it("a boost changes neither the Venue's sync record nor the offline manifest", async () => {
    const place = await venue();
    await insertLocalization(prisma, place.id, 'en', place.contentHash, { name: 'Ốc Oanh (en)' });
    await prisma.$transaction((tx) => bumpSyncVersion(tx, place.id));
    // Every write older than the sync lag, so delta sync's cap reaches it.
    await prisma.$executeRaw`UPDATE places SET updated_at = updated_at - interval '10 seconds'`;

    const snapshot = async () => {
      const sync = await services.queries.syncPlaces(
        { areaId: tax.area.id, lang: 'en', since: '' },
        device(),
      );
      const manifest = await services.offline.getManifest(
        { areaId: tax.area.id, lang: 'en' },
        device(),
      );
      return {
        sync: createHash('sha256').update(JSON.stringify(sync.places)).digest('hex'),
        version: (
          await prisma.place.findUniqueOrThrow({
            where: { id: place.id },
            select: { syncVersion: true },
          })
        ).syncVersion,
        manifest: createHash('sha256').update(manifest.manifestJson).digest('hex'),
      };
    };
    const before = await snapshot();
    // Answered afresh, not from the manifest cache. The places snapshot is stored under the area's
    // highest `sync_version`: an unmoved version is the same snapshot, and the records it holds are
    // the sync records compared above.
    services.manifestCache.values.clear();
    await consumer.handle(changed(place.id, DISCOVERY_BOOST_WEIGHT, '2026-11-04T09:00:00.000Z'));
    expect(await boostOf(place.id)).toBe(DISCOVERY_BOOST_WEIGHT);
    expect(await snapshot()).toEqual(before);
  });
});
