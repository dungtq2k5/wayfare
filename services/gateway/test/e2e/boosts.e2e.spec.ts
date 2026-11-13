// Discovery boosts through the gateway (api-endpoints-plan §5.2, §3.1, §3.5): the owner's read and
// set, the owner's Venues with their boost composed from billing, and the admin's Place with its
// boost — each composed read still loading, the boost left out, when billing doesn't answer.
import { status } from '@grpc/grpc-js';
import { newId } from '@wayfare/contracts';
import { billingGrpc, catalogGrpc } from '@wayfare/contracts/grpc';
import { adminPlaceFixture } from '@wayfare/contracts/testing';
import { toProtoTimestamp } from '@wayfare/nest-common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway, serviceError } from '../support/app';
import type { E2eApp } from '../support/app';

let gateway: E2eApp;
const ownerId = newId();
const owner = () =>
  `wf_at=${accountToken({ userId: ownerId, ov: true, ev: true, perms: ['owner.access'] })}`;
const staff = (perms: string[]) => `wf_at=${accountToken({ userId: newId(), perms })}`;
const call = (method: 'get' | 'put', path: string, cookie: string, body?: object) => {
  const agent = request(gateway.app.getHttpServer());
  const req = agent[method](`/api/v1${path}`)
    .set('X-Wayfare-Client', 'console')
    .set('Cookie', cookie);
  return body === undefined ? req : req.send(body);
};

const since = new Date('2026-11-01T09:00:00.000Z');
const ended = new Date('2026-11-02T09:00:00.000Z');

beforeAll(async () => {
  gateway = await bootGateway();
});
afterAll(() => gateway.app.close());
beforeEach(() => {
  gateway.catalog.reset();
  gateway.billing.reset();
  gateway.identity.reset();
  gateway.redis.values.clear();
});

describe('/owner/boosts', () => {
  it('reads the slots, the live boosts and the ended ones', async () => {
    const [live, gone] = [newId(), newId()];
    gateway.billing.boosts.handlers.getMyBoosts = () =>
      Promise.resolve({
        slots: 1,
        boosts: [
          { placeId: live, weight: 50, since: toProtoTimestamp(since) },
          {
            placeId: gone,
            weight: 50,
            since: toProtoTimestamp(since),
            endedAt: toProtoTimestamp(ended),
            endedReason: billingGrpc.BoostEndedReason.BOOST_ENDED_REASON_PLACE_UNAVAILABLE,
          },
        ],
      });
    const res = await call('get', '/owner/boosts', owner());
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      slots: 1,
      live: [{ placeId: live, since: since.toISOString() }],
      ended: [
        {
          placeId: gone,
          since: since.toISOString(),
          endedAt: ended.toISOString(),
          endedReason: 'PLACE_UNAVAILABLE',
        },
      ],
    });
  });

  it('sends the complete set, and answers 409 with the limit beyond the slots', async () => {
    const placeIds = [newId(), newId()];
    gateway.billing.boosts.handlers.setMyBoosts = () =>
      Promise.reject(
        serviceError(status.FAILED_PRECONDITION, {
          'wf-error-code': 'BOOST_SLOTS_EXCEEDED',
          'wf-error-details': JSON.stringify({ limit: 1 }),
        }),
      );
    const res = await call('put', '/owner/boosts', owner(), { placeIds });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'BOOST_SLOTS_EXCEEDED', details: { limit: 1 } });
    expect(gateway.billing.boosts.calls[0]?.request).toEqual({ placeIds });
    // A Venue twice is refused before billing is asked.
    const twice = await call('put', '/owner/boosts', owner(), {
      placeIds: [placeIds[0], placeIds[0]],
    });
    expect(twice.status).toBe(400);
  });
});

describe("the owner's Venues", () => {
  const venue = (id: string): catalogGrpc.OwnerPlace =>
    ({
      id,
      publicCode: 'Z63TCMMT',
      nameVi: 'Ốc Oanh',
      categoryCode: 'STREET_FOOD',
      areaCode: 'hcmc-d4-vinh-khanh',
      status: catalogGrpc.PlaceStatus.PLACE_STATUS_ACTIVE,
      autoNarration: true,
      statusChangedAt: toProtoTimestamp(since),
      localizations: [],
      updatedAt: toProtoTimestamp(since),
    }) as unknown as catalogGrpc.OwnerPlace;

  it('carry their boost from billing, and load without it when billing is down', async () => {
    const [boosted, plain] = [newId(), newId()];
    gateway.catalog.ownerPlaces.handlers.listMyPlaces = () =>
      Promise.resolve({ places: [venue(boosted), venue(plain)] });
    gateway.billing.boosts.handlers.getMyBoosts = () =>
      Promise.resolve({
        slots: 1,
        boosts: [{ placeId: boosted, weight: 50, since: toProtoTimestamp(since) }],
      });
    const res = await call('get', '/owner/places', owner());
    expect(res.status).toBe(200);
    const rows = (res.body as { data: { boosted?: unknown }[] }).data;
    expect(rows.map((row) => row.boosted)).toEqual([{ since: since.toISOString() }, null]);

    gateway.billing.boosts.handlers.getMyBoosts = () =>
      Promise.reject(serviceError(status.UNAVAILABLE, {}));
    const blind = await call('get', '/owner/places', owner());
    expect(blind.status).toBe(200);
    const blindRows = (blind.body as { data: object[] }).data;
    expect(blindRows.every((row) => !('boosted' in row))).toBe(true);
  });
});

describe("an admin's Place", () => {
  it('carries its live boost, and loads without it when billing is down', async () => {
    const place = adminPlaceFixture({
      kind: catalogGrpc.PlaceKind.PLACE_KIND_VENUE,
      ownerUserId: ownerId,
    });
    gateway.catalog.placeAdmin.handlers.getPlaceAdmin = () => Promise.resolve({ place });
    const accountId = newId();
    gateway.billing.boosts.handlers.getPlaceBoost = () =>
      Promise.resolve({
        boost: {
          since: toProtoTimestamp(since),
          billingAccountId: accountId,
          planCode: 'GROWTH',
          slots: 1,
        },
      });
    const res = await call('get', `/admin/places/${place.id}`, staff(['place.read']));
    expect(res.status).toBe(200);
    expect(res.body.data.boost).toEqual({
      since: since.toISOString(),
      billingAccountId: accountId,
      planCode: 'GROWTH',
      slots: 1,
    });

    gateway.billing.boosts.handlers.getPlaceBoost = () =>
      Promise.reject(serviceError(status.UNAVAILABLE, {}));
    const blind = await call('get', `/admin/places/${place.id}`, staff(['place.read']));
    expect(blind.status).toBe(200);
    expect('boost' in blind.body.data).toBe(false);
  });
});

describe("an account's boosts", () => {
  it('carry the Venues’ names from catalog, and null when catalog is down', async () => {
    const accountId = newId();
    const placeId = newId();
    const grants: billingGrpc.Entitlements = {
      maxPlaces: 10,
      autoNarration: true,
      narrationLanguageScope: billingGrpc.NarrationLanguageScope.NARRATION_LANGUAGE_SCOPE_LAUNCH,
      maxPhotosPerPlace: 8,
      maxMenuItemsPerPlace: 200,
      discoveryBoostSlots: 1,
      aiCreditsPerDay: 10,
      analyticsLevel: billingGrpc.AnalyticsLevel.ANALYTICS_LEVEL_BASIC,
      canSellVouchers: true,
      voucherCommissionBps: 1500,
    };
    gateway.billing.accounts.handlers.getAccount = () =>
      Promise.resolve({
        account: {
          summary: {
            id: accountId,
            ownerUserId: ownerId,
            planCode: 'GROWTH',
            subscriptionStatus: billingGrpc.SubscriptionStatus.SUBSCRIPTION_STATUS_ACTIVE,
            pinned: false,
            entitlementsVersion: '2',
            createdAt: toProtoTimestamp(since),
          },
          cancelAtPeriodEnd: false,
          entitlements: grants,
          planGrants: grants,
          recentEvents: [],
          boosts: [{ placeId, weight: 50, since: toProtoTimestamp(since) }],
        },
      });
    gateway.catalog.places.handlers.batchGetPlaceSummaries = () =>
      Promise.resolve({
        places: [
          {
            id: placeId,
            kind: catalogGrpc.PlaceKind.PLACE_KIND_VENUE,
            ownerUserId: ownerId,
            status: catalogGrpc.PlaceStatus.PLACE_STATUS_ACTIVE,
            nameVi: 'Ốc Oanh',
          },
        ],
      });
    gateway.identity.adminUsers.handlers.getUserNames = () =>
      Promise.resolve({ users: [{ id: ownerId, name: 'Minh Tran', email: 'minh@example.com' }] });
    const reader = staff(['billing.account.read']);
    const res = await call('get', `/admin/billing/accounts/${accountId}`, reader);
    expect(res.status).toBe(200);
    expect((res.body as { data: { boosts: unknown[] } }).data.boosts).toEqual([
      {
        placeId,
        placeName: 'Ốc Oanh',
        weight: 50,
        since: since.toISOString(),
        endedAt: null,
        endedReason: null,
      },
    ]);

    gateway.catalog.places.handlers.batchGetPlaceSummaries = () =>
      Promise.reject(serviceError(status.UNAVAILABLE, {}));
    const blind = await call('get', `/admin/billing/accounts/${accountId}`, reader);
    expect(blind.status).toBe(200);
    expect(
      (blind.body as { data: { boosts: { placeName: unknown }[] } }).data.boosts[0]?.placeName,
    ).toBeNull();
  });
});
