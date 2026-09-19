import { status } from '@grpc/grpc-js';
import { newId } from '@wayfare/contracts';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import {
  adminPlaceFixture,
  areaFixture,
  categoryFixture,
  FIXTURE_PUBLIC_CODE,
  placeDetailFixture,
  placeSummaryFixture,
  placeSyncRecordFixture,
} from '@wayfare/contracts/testing';
import { toProtoTimestamp } from '@wayfare/nest-common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway, deviceToken, serviceError } from '../support/app';
import type { E2eApp } from '../support/app';

let gateway: E2eApp;
const server = () => gateway.app.getHttpServer();
const areaId = newId();
const placeId = newId();

const PLACE_PERMISSIONS = [
  'place.read',
  'place.create',
  'place.update',
  'place.editorial.update',
  'place.publish',
  'place.delete',
];

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

/** A phone's request, carrying a device token. */
const phone = (path: string) =>
  request(server())
    .get(`/api/v1${path}`)
    .set('X-Wayfare-Client', 'mobile')
    .set('X-Wayfare-App-Version', '1.0.0')
    .set('Authorization', `Bearer ${deviceToken()}`);

/** A console request with the given permissions. */
function console_(method: Method, path: string, perms: string[] = PLACE_PERMISSIONS) {
  const agent = request(server());
  return agent[method](`/api/v1${path}`)
    .set('X-Wayfare-Client', 'console')
    .set('Cookie', `wf_at=${accountToken({ perms })}`);
}

const reject = (code: number, errorCode: string) => () =>
  Promise.reject(serviceError(code, { 'wf-error-code': errorCode }));

beforeAll(async () => {
  gateway = await bootGateway();
});

afterAll(() => gateway.app.close());

beforeEach(() => {
  gateway.identity.reset();
  gateway.catalog.reset();
  gateway.redis.values.clear();
  const { placeQueries, placeAdmin, uploads } = gateway.catalog;
  placeQueries.handlers.syncPlaces = () =>
    Promise.resolve({
      places: [placeSyncRecordFixture()],
      removedPlaceIds: [newId()],
      datasetVersion: '42',
      complete: false,
    });
  placeQueries.handlers.nearbyPlaces = () =>
    Promise.resolve({ places: [placeSummaryFixture({ sponsored: true })] });
  placeQueries.handlers.getPlace = () => Promise.resolve({ place: placeDetailFixture() });
  placeQueries.handlers.getPlaceByCode = () => Promise.resolve({ place: placeDetailFixture() });
  placeQueries.handlers.resolvePublicCode = () => Promise.resolve({ exists: true });
  placeQueries.handlers.listCategories = () => Promise.resolve({ categories: [categoryFixture()] });
  placeQueries.handlers.listAreas = () => Promise.resolve({ areas: [areaFixture()] });
  const withPlace = () => Promise.resolve({ place: adminPlaceFixture() });
  for (const method of [
    'getPlaceAdmin',
    'createEditorialPlace',
    'updatePlace',
    'updateEditorial',
    'replacePhotos',
    'replaceMenu',
    'replaceOpeningHours',
    'deactivatePlace',
    'restorePlace',
  ]) {
    placeAdmin.handlers[method] = withPlace;
  }
  placeAdmin.handlers.listPlaces = () =>
    Promise.resolve({
      places: [
        {
          id: placeId,
          kind: catalogGrpc.PlaceKind.PLACE_KIND_EDITORIAL,
          publicCode: FIXTURE_PUBLIC_CODE,
          nameVi: 'Chợ',
          categoryCode: 'MARKET',
          areaId,
          areaCode: 'hcmc-d1-core',
          status: catalogGrpc.PlaceStatus.PLACE_STATUS_DRAFT,
          syncVersion: '9',
          updatedAt: toProtoTimestamp(new Date()),
        },
      ],
      page: { page: 1, pageSize: 20, total: 1 },
    });
  placeAdmin.handlers.requestActivation = () =>
    Promise.resolve({
      status: catalogGrpc.PlaceStatus.PLACE_STATUS_PROCESSING,
      missing: ['en.text', 'en.audio'],
    });
  placeAdmin.handlers.deletePlace = () => Promise.resolve({});
  placeAdmin.handlers.getPlaceQr = () =>
    Promise.resolve({ svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', publicCode: 'K7M2Q9XA' });
  uploads.handlers.createUpload = () =>
    Promise.resolve({
      uploadId: newId(),
      uploadUrl: 'http://localhost:4443/b/uploads/x/original?X-Goog-Signature=abc',
      expiresAt: toProtoTimestamp(new Date()),
      requiredHeaders: { 'Content-Type': 'image/jpeg' },
    });
  uploads.handlers.confirmUpload = (req: { uploadId: string }) =>
    Promise.resolve({
      uploadId: req.uploadId,
      variants: placeDetailFixture().photos[0]!.variants,
    });
});

describe('GET /sync/places', () => {
  const sync = (query: string) => phone(`/sync/places?${query}`);

  it('serves a page with its version as a number, meta and an ETag', async () => {
    const res = await sync(`areaId=${areaId}&lang=ja-JP&since=7`);
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe(`"${areaId}:ja-JP:42"`);
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect(res.body.meta).toEqual({ complete: false });
    expect(res.body.data.datasetVersion).toBe(42);
    expect(res.body.data.places[0]).toMatchObject({
      publicCode: FIXTURE_PUBLIC_CODE,
      kind: 'EDITORIAL',
      localization: { contentTier: 'REQUESTED', audio: { durationMs: 31_000 } },
      priceBand: null,
    });
    expect(res.body.data.places[0]).not.toHaveProperty('discoveryBoost');
    expect(gateway.catalog.placeQueries.calls[0]!.request).toEqual({
      areaId,
      lang: 'ja-JP',
      since: '7',
    });
  });

  it('answers a matching If-None-Match with an empty 304', async () => {
    const res = await sync(`areaId=${areaId}&lang=en`).set('If-None-Match', `"${areaId}:en:42"`);
    expect(res.status).toBe(304);
    expect(res.text ?? '').toBe('');
    expect(gateway.catalog.placeQueries.calls[0]!.request).toMatchObject({ since: '0' });
  });

  it('refuses a bad area, a bad version, and a caller without a device', async () => {
    for (const query of [
      `areaId=not-a-uuid&lang=en`,
      `areaId=${areaId}&lang=en&since=-1`,
      `areaId=${areaId}&lang=en&since=9007199254740993`,
      `areaId=${areaId}`,
      `areaId=${areaId}&lang=en&extra=1`,
    ]) {
      expect((await sync(query)).status, query).toBe(400);
    }
    const anonymous = await request(server())
      .get(`/api/v1/sync/places?areaId=${areaId}&lang=en`)
      .set('X-Wayfare-Client', 'web');
    expect(anonymous.status).toBe(401);
  });

  it('refuses a version past the safe range from catalog as a server error', async () => {
    gateway.catalog.placeQueries.handlers.syncPlaces = () =>
      Promise.resolve({
        places: [],
        removedPlaceIds: [],
        datasetVersion: '9007199254740993',
        complete: true,
      });
    expect((await sync(`areaId=${areaId}&lang=en`)).status).toBe(500);
  });
});

describe('GET /places', () => {
  it('nearby: defaults, bounds, and the sponsored flag', async () => {
    const res = await phone('/places/nearby?lat=10.77&lng=106.69&lang=en');
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({
      sponsored: true,
      walkingEtaMinutes: 3,
      cardPhoto: { width: 800 },
    });
    expect(gateway.catalog.placeQueries.calls[0]!.request).toEqual({
      lat: 10.77,
      lng: 106.69,
      radiusM: 1000,
      lang: 'en',
      limit: 20,
    });
    for (const query of ['radiusM=5001', 'limit=51', 'lat=91', 'categoryCode=bad code']) {
      expect((await phone(`/places/nearby?lat=10&lng=106&lang=en&${query}`)).status, query).toBe(
        400,
      );
    }
  });

  it('detail: the composition without billing, and an ETag', async () => {
    const res = await phone(`/places/${placeId}?lang=en`);
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe(`"${placeId}:en:42"`);
    expect(res.body.data).toMatchObject({ offers: [], isFavorite: false, menu: null });
    expect(res.body).not.toHaveProperty('meta');
    const cached = await phone(`/places/${placeId}?lang=en`).set(
      'If-None-Match',
      res.headers.etag!,
    );
    expect(cached.status).toBe(304);
  });

  it('by code: canonicalized first, and an unavailable Place explained', async () => {
    const res = await phone('/places/by-code/k7m2-q9xa?lang=vi');
    expect(res.status).toBe(200);
    expect(gateway.catalog.placeQueries.calls[0]!.request).toEqual({
      publicCode: 'K7M2Q9XA',
      lang: 'vi',
    });
    expect((await phone('/places/by-code/NOT-A-CODE!?lang=vi')).status).toBe(400);
    gateway.catalog.placeQueries.handlers.getPlaceByCode = reject(
      status.NOT_FOUND,
      'PLACE_UNAVAILABLE',
    );
    const gone = await phone('/places/by-code/K7M2Q9XA?lang=vi');
    expect(gone.status).toBe(404);
    expect(gone.body.error.code).toBe('PLACE_UNAVAILABLE');
  });
});

describe('GET /q/:publicCode', () => {
  it('counts the scan and redirects, unprefixed, with no client header', async () => {
    const res = await request(server()).get('/q/k7m2q9xa');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://wayfare.test/p/K7M2Q9XA');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(gateway.catalog.placeQueries.calls[0]!.request).toEqual({ publicCode: 'K7M2Q9XA' });
    expect((await request(server()).get('/api/v1/q/K7M2Q9XA')).status).toBe(404);
  });

  it('redirects a malformed code without asking catalog, and while catalog is down', async () => {
    const odd = await request(server()).get('/q/%3Cscript%3E');
    expect(odd.status).toBe(302);
    expect(odd.headers.location).toBe('https://wayfare.test/p/%3Cscript%3E');
    expect(gateway.catalog.placeQueries.calls).toHaveLength(0);
    gateway.catalog.placeQueries.handlers.resolvePublicCode = () =>
      Promise.reject(serviceError(status.UNAVAILABLE));
    const down = await request(server()).get('/q/K7M2Q9XA');
    expect(down.status).toBe(302);
  });
});

describe('GET /categories and /areas', () => {
  it('are public and publicly cacheable', async () => {
    const categories = await request(server())
      .get('/api/v1/categories')
      .set('X-Wayfare-Client', 'web');
    expect(categories.status).toBe(200);
    expect(categories.headers['cache-control']).toBe('public, max-age=300');
    expect(categories.body.data).toEqual([
      {
        id: categoryFixture().id,
        code: 'MARKET',
        appliesTo: 'ANY',
        icon: 'market',
        sortOrder: 40,
      },
    ]);
    const areas = await request(server()).get('/api/v1/areas').set('X-Wayfare-Client', 'web');
    expect(areas.status).toBe(200);
    expect(areas.headers['cache-control']).toBe('public, max-age=300');
    expect(areas.body.data[0]).toMatchObject({
      code: 'hcmc-d1-core',
      boundary: { type: 'Polygon' },
      mapPack: null,
      datasetVersion: 42,
    });
  });
});

describe('/uploads', () => {
  it('signs and confirms for staff who create or update Places, and for owners', async () => {
    const body = { purpose: 'PLACE_PHOTO', contentType: 'image/jpeg', bytes: 1000 };
    for (const perms of [['place.create'], ['place.update'], ['owner.access']]) {
      expect((await console_('post', '/uploads', perms).send(body)).status).toBe(201);
    }
    expect((await console_('post', '/uploads', ['place.read']).send(body)).status).toBe(403);
    expect(gateway.catalog.uploads.calls[0]!.request).toEqual({
      purpose: catalogGrpc.UploadPurpose.UPLOAD_PURPOSE_PLACE_PHOTO,
      contentType: 'image/jpeg',
      bytes: 1000,
    });
    const heic = await console_('post', '/uploads').send({ ...body, contentType: 'image/heic' });
    expect(heic.status).toBe(400);
    const uploadId = newId();
    const confirmed = await console_('post', `/uploads/${uploadId}/confirm`);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data).toMatchObject({ uploadId, variants: { card: { width: 800 } } });
  });

  it('passes the size refusal through as 422', async () => {
    gateway.catalog.uploads.handlers.createUpload = reject(
      status.FAILED_PRECONDITION,
      'UPLOAD_TOO_LARGE',
    );
    const res = await console_('post', '/uploads').send({
      purpose: 'PLACE_PHOTO',
      contentType: 'image/png',
      bytes: 6_000_000,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UPLOAD_TOO_LARGE');
  });
});

describe('/admin/places', () => {
  const content = {
    nameVi: 'Chợ Bến Thành',
    descriptionVi: 'Chợ có từ năm 1914.',
    categoryCode: 'MARKET',
    location: { lat: 10.77, lng: 106.69 },
  };
  const ROUTES: [Method, string, string, object | undefined, number][] = [
    ['get', '/admin/places', 'place.read', undefined, 200],
    ['get', `/admin/places/${placeId}`, 'place.read', undefined, 200],
    [
      'post',
      '/admin/places',
      'place.create',
      { ...content, triggerRadiusM: 30, narrationPriority: 50, requestActivation: true },
      201,
    ],
    ['patch', `/admin/places/${placeId}`, 'place.update', { nameVi: 'Tên mới' }, 200],
    [
      'patch',
      `/admin/places/${placeId}/editorial`,
      'place.editorial.update',
      { triggerRadiusM: 40 },
      200,
    ],
    ['put', `/admin/places/${placeId}/photos`, 'place.update', { items: [] }, 200],
    [
      'put',
      `/admin/places/${placeId}/menu`,
      'place.update',
      { menuCurrency: 'VND', items: [] },
      200,
    ],
    ['put', `/admin/places/${placeId}/opening-hours`, 'place.update', { items: [] }, 200],
    ['post', `/admin/places/${placeId}/activate`, 'place.publish', undefined, 200],
    ['post', `/admin/places/${placeId}/deactivate`, 'place.publish', { reason: 'Đóng cửa' }, 200],
    ['delete', `/admin/places/${placeId}`, 'place.delete', undefined, 204],
    ['post', `/admin/places/${placeId}/restore`, 'place.delete', undefined, 200],
    ['get', `/admin/places/${placeId}/qr`, 'place.read', undefined, 200],
  ];

  it.each(ROUTES)('%s %s requires %s', async (method, path, permission, body, expected) => {
    const others = PLACE_PERMISSIONS.filter((code) => code !== permission);
    expect((await console_(method, path, others).send(body)).status).toBe(403);
    const res = await console_(method, path, [permission]).send(body);
    expect(res.status).toBe(expected);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('lists a page and shows a Place with nulls for what is absent', async () => {
    const list = await console_('get', '/admin/places?status=DRAFT&includeDeleted=true&q=chợ');
    expect(list.body.meta).toEqual({ page: 1, pageSize: 20, total: 1 });
    expect(list.body.data[0]).toMatchObject({ status: 'DRAFT', cover: null, deletedAt: null });
    expect(gateway.catalog.placeAdmin.calls[0]!.request).toMatchObject({
      status: catalogGrpc.PlaceStatus.PLACE_STATUS_DRAFT,
      includeDeleted: true,
      page: { q: 'chợ', sort: '-updatedAt' },
    });
    const detail = await console_('get', `/admin/places/${placeId}`);
    expect(detail.body.data).toMatchObject({
      status: 'PROCESSING',
      ownerUserId: null,
      publishedAt: null,
      activationMissing: ['en.text', 'en.audio'],
      synthesisJobs: [],
      submissions: [],
    });
  });

  it('creates with the editorial values and refuses them on a content edit', async () => {
    const created = await console_('post', '/admin/places').send({
      ...content,
      addressVi: null,
      triggerRadiusM: 30,
      narrationPriority: 50,
      photos: [{ uploadId: newId(), altTextVi: 'Cổng' }],
      openingHours: [{ weekday: 1, opensAt: '06:00', closesAt: '18:00' }],
      requestActivation: false,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.place.id).toBe(adminPlaceFixture().id);
    const [call] = gateway.catalog.placeAdmin.calls;
    expect(call!.request).toMatchObject({
      content: { nameVi: 'Chợ Bến Thành', location: { lat: 10.77, lng: 106.69 } },
      triggerRadiusM: 30,
      openingHours: [{ weekday: 1, opensAt: '06:00', closesAt: '18:00', isClosed: false }],
    });
    expect((call!.request as { content: object }).content).not.toHaveProperty('addressVi');

    const firewall = await console_('patch', `/admin/places/${placeId}`).send({
      narrationPriority: 90,
    });
    expect(firewall.status).toBe(400);
    const radius = await console_('post', '/admin/places').send({
      ...content,
      triggerRadiusM: 500,
      narrationPriority: 50,
      requestActivation: false,
    });
    expect(radius.status).toBe(400);
  });

  it('sends a cleared field as its empty value, and an absent one not at all', async () => {
    await console_('patch', `/admin/places/${placeId}`).send({ phone: null, priceBand: null });
    expect(gateway.catalog.placeAdmin.calls[0]!.request).toEqual({
      placeId,
      location: undefined,
      phone: '',
      priceBand: 0,
    });
  });

  it('refuses a menu price over its ceiling before calling catalog', async () => {
    const res = await console_('put', `/admin/places/${placeId}/menu`).send({
      menuCurrency: 'USD',
      items: [{ nameVi: 'Tôm hùm', priceMinor: 200_001 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.issues).toEqual([
      { path: '/items/0/priceMinor', code: 'too_big' },
    ]);
    expect(gateway.catalog.placeAdmin.calls).toHaveLength(0);
  });

  it('answers the activation gate, and serves the sticker as SVG with the QR host', async () => {
    const activation = await console_('post', `/admin/places/${placeId}/activate`);
    expect(activation.body.data).toEqual({
      status: 'PROCESSING',
      missing: ['en.text', 'en.audio'],
    });
    const qr = await console_('get', `/admin/places/${placeId}/qr`);
    expect(qr.headers['content-type']).toMatch(/^image\/svg\+xml/);
    // An image type arrives as bytes.
    expect(Buffer.from(qr.body as Buffer).toString('utf8')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    );
    expect(gateway.catalog.placeAdmin.calls.at(-1)!.request).toEqual({
      placeId,
      qrBaseUrl: 'https://go.wayfare.test',
    });
  });

  it('passes catalog refusals through with their status', async () => {
    gateway.catalog.placeAdmin.handlers.deletePlace = reject(
      status.FAILED_PRECONDITION,
      'PLACE_HAS_LIVE_VOUCHERS',
    );
    const res = await console_('delete', `/admin/places/${placeId}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PLACE_HAS_LIVE_VOUCHERS');
  });
});
