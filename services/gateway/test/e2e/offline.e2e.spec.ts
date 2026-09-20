// `/admin/map-packs`, `/offline/areas/:areaId/manifest[/diff]` and `/me/favorites`
// (api-endpoints-plan §2.3, §2.4, §3.6): who may call them, what the gateway refuses before
// catalog, what it forwards, and how catalog's answers and refusals map.
import { status } from '@grpc/grpc-js';
import { newId } from '@wayfare/contracts';
import type { OfflineManifest } from '@wayfare/contracts';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway, deviceToken, serviceError } from '../support/app';
import type { E2eApp } from '../support/app';

let gateway: E2eApp;
const staff = (perms: string[]) => `wf_at=${accountToken({ userId: newId(), perms })}`;
const console_ = (method: 'get' | 'post', path: string, cookie: string) => {
  const agent = request(gateway.app.getHttpServer());
  return agent[method](`/api/v1${path}`).set('X-Wayfare-Client', 'console').set('Cookie', cookie);
};
const mobile = (method: 'get' | 'put' | 'delete', path: string) => {
  const agent = request(gateway.app.getHttpServer());
  return agent[method](`/api/v1${path}`)
    .set('X-Wayfare-Client', 'mobile')
    .set('Authorization', `Bearer ${deviceToken()}`);
};

beforeAll(async () => {
  gateway = await bootGateway();
});
afterAll(() => gateway.app.close());
beforeEach(() => gateway.catalog.reset());

const areaId = newId();
const sha = 'a'.repeat(64);
const prefix = `maps/hcmc-d1-core/${'a'.repeat(16)}/`;
const object = (name: string, bytes: number) => ({ path: `${prefix}${name}`, sha256: sha, bytes });

function pack(over: Partial<catalogGrpc.MapPack> = {}): catalogGrpc.MapPack {
  const wire = (name: string, bytes: number) => ({ ...object(name, bytes), bytes: String(bytes) });
  return {
    id: newId(),
    areaId,
    version: 1,
    status: catalogGrpc.MapPackStatus.MAP_PACK_STATUS_BUILDING,
    pmtiles: wire('map.pmtiles', 5_000_000),
    style: wire('style.json', 20_000),
    assets: [wire('fonts/Noto_Sans_Regular/7680-7935.pbf', 30_000)],
    totalBytes: '5050000',
    source: 'protomaps-20260915',
    sourceDate: '2026-09-15',
    minZoom: 10,
    maxZoom: 15,
    buildTool: 'pmtiles 1.28.0',
    publishedAt: undefined,
    retiredAt: undefined,
    createdAt: toProtoTimestamp(new Date('2026-09-19T10:00:00.000Z')),
    ...over,
  };
}

const body = {
  areaId,
  pmtiles: object('map.pmtiles', 5_000_000),
  style: object('style.json', 20_000),
  assets: [object('fonts/Noto_Sans_Regular/7680-7935.pbf', 30_000)],
  source: 'protomaps-20260915',
  sourceDate: '2026-09-15',
  minZoom: 10,
  maxZoom: 15,
  buildTool: 'pmtiles 1.28.0',
};

describe('/admin/map-packs', () => {
  it('registers with a long deadline, lists and publishes under map_pack.manage', async () => {
    gateway.catalog.mapPackAdmin.handlers.registerMapPack = () =>
      Promise.resolve({ mapPack: pack() });
    const manage = staff(['map_pack.manage']);
    const created = await console_('post', '/admin/map-packs', manage).send(body);
    expect(created.status).toBe(201);
    expect(created.body.data.mapPack).toMatchObject({
      status: 'BUILDING',
      pmtiles: body.pmtiles,
      totalBytes: 5_050_000,
      publishedAt: null,
    });
    const sent = gateway.catalog.mapPackAdmin.calls[0]!;
    expect((sent.request as catalogGrpc.RegisterMapPackRequest).pmtiles!.bytes).toBe('5000000');

    gateway.catalog.mapPackAdmin.handlers.publishMapPack = () =>
      Promise.resolve({
        mapPack: pack({
          status: catalogGrpc.MapPackStatus.MAP_PACK_STATUS_PUBLISHED,
          publishedAt: toProtoTimestamp(new Date()),
        }),
      });
    const published = await console_('post', `/admin/map-packs/${newId()}/publish`, manage);
    expect(published.status).toBe(200);
    expect(published.body.data.mapPack.status).toBe('PUBLISHED');

    gateway.catalog.mapPackAdmin.handlers.listMapPacks = () =>
      Promise.resolve({ mapPacks: [pack()] });
    const list = await console_('get', `/admin/map-packs?areaId=${areaId}`, manage);
    expect(list.status).toBe(200);
    expect(gateway.catalog.mapPackAdmin.calls.at(-1)!.request).toEqual({ areaId });
    expect((await console_('get', '/admin/map-packs', staff(['place.read']))).status).toBe(403);
  });

  it('refuses a malformed body before catalog, and passes catalog’s refusals through', async () => {
    const manage = staff(['map_pack.manage']);
    for (const bad of [
      { ...body, pmtiles: { ...body.pmtiles, sha256: 'nothex' } },
      { ...body, style: { ...body.style, path: `${prefix}../photos/x.jpg` } },
      { ...body, maxZoom: 9 },
    ]) {
      expect((await console_('post', '/admin/map-packs', manage).send(bad)).status).toBe(400);
    }
    expect(gateway.catalog.mapPackAdmin.calls).toEqual([]);

    gateway.catalog.mapPackAdmin.handlers.registerMapPack = () =>
      Promise.reject(
        serviceError(status.FAILED_PRECONDITION, {
          'wf-error-code': 'MAP_PACK_HASH_MISMATCH',
          'wf-error-details': JSON.stringify({ path: body.pmtiles.path }),
        }),
      );
    const refused = await console_('post', '/admin/map-packs', manage).send(body);
    expect(refused.status).toBe(422);
    expect(refused.body.error).toMatchObject({
      code: 'MAP_PACK_HASH_MISMATCH',
      details: { path: body.pmtiles.path },
    });
  });
});

describe('/offline/areas/:areaId/manifest', () => {
  const asset = (path: string, bytes: number) => ({
    path,
    url: `http://localhost:4443/wayfare-media-local/${path}`,
    sha256: sha,
    bytes,
  });
  const manifest: OfflineManifest = {
    areaId,
    lang: 'en',
    datasetVersion: 42,
    mapPack: {
      version: 1,
      pmtiles: asset(`${prefix}map.pmtiles`, 5_000_000),
      style: asset(`${prefix}style.json`, 20_000),
      assets: [],
    },
    places: asset('offline/hcmc-d1-core/en/40-18.ndjson.gz', 9_000),
    photos: [],
    audio: [],
    totalBytes: 5_029_000,
  };

  it('serves the manifest to a device, privately cached, and the diff with its 409', async () => {
    gateway.catalog.offline.handlers.getManifest = () =>
      Promise.resolve({ manifestJson: JSON.stringify(manifest) });
    const res = await mobile('get', `/offline/areas/${areaId}/manifest?lang=en`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(manifest);
    expect(res.headers['cache-control']).toBe('private, max-age=60');
    expect(gateway.catalog.offline.calls[0]!.request).toEqual({ areaId, lang: 'en' });

    gateway.catalog.offline.handlers.getManifestDiff = () =>
      Promise.reject(
        serviceError(status.FAILED_PRECONDITION, { 'wf-error-code': 'DIFF_UNAVAILABLE' }),
      );
    const diff = await mobile(
      'get',
      `/offline/areas/${areaId}/manifest/diff?lang=en&fromDatasetVersion=40&fromMapPackVersion=1`,
    );
    expect(diff.status).toBe(409);
    expect(gateway.catalog.offline.calls.at(-1)!.request).toEqual({
      areaId,
      lang: 'en',
      fromDatasetVersion: '40',
      fromMapPackVersion: 1,
    });
    expect(
      (await mobile('get', `/offline/areas/${areaId}/manifest/diff?lang=en&fromDatasetVersion=x`))
        .status,
    ).toBe(400);
  });

  it('refuses a caller without a device', async () => {
    const res = await request(gateway.app.getHttpServer())
      .get(`/api/v1/offline/areas/${areaId}/manifest?lang=en`)
      .set('X-Wayfare-Client', 'mobile');
    expect(res.status).toBe(401);
  });
});

describe('/me/favorites', () => {
  it('lists with a cursor, and adds and removes with 204', async () => {
    const placeId = newId();
    gateway.catalog.favorites.handlers.listFavorites = () =>
      Promise.resolve({
        favorites: [
          {
            placeId,
            savedAt: toProtoTimestamp(new Date('2026-09-19T10:00:00.000Z')),
            place: {
              id: placeId,
              kind: catalogGrpc.PlaceKind.PLACE_KIND_EDITORIAL,
              publicCode: 'W4YF4R3A',
              categoryCode: 'MARKET',
              location: { lat: 10.7725, lng: 106.698 },
              name: 'Ben Thanh Market',
              lang: 'en',
              contentTier: catalogGrpc.ContentTier.CONTENT_TIER_REQUESTED,
              stale: false,
              cardPhoto: undefined,
              distanceM: 0,
              walkingEtaMinutes: 0,
              sponsored: false,
            },
          },
        ],
        page: { nextCursor: 'abc' },
      });
    const list = await mobile('get', '/me/favorites?lang=en&limit=10');
    expect(list.status).toBe(200);
    expect(list.body.meta).toEqual({ nextCursor: 'abc' });
    expect(list.body.data[0]).toMatchObject({
      placeId,
      savedAt: '2026-09-19T10:00:00.000Z',
      place: { name: 'Ben Thanh Market', cardPhoto: null },
    });
    expect(list.body.data[0].place.distanceM).toBeUndefined();

    gateway.catalog.favorites.handlers.addFavorite = () => Promise.resolve({});
    gateway.catalog.favorites.handlers.removeFavorite = () => Promise.resolve({});
    expect((await mobile('put', `/me/favorites/${placeId}`)).status).toBe(204);
    expect((await mobile('delete', `/me/favorites/${placeId}`)).status).toBe(204);
    expect((await mobile('put', '/me/favorites/not-an-id')).status).toBe(400);
  });
});
