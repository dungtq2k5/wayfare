// Tours (api-endpoints-plan §2.1–2.2, §3.6): the tourist's reads — a list by area, a tour by id or
// by its printed code, a stop whose Place isn't live drawn as a gap — and the console's
// `/admin/tours`, each answer mapped from catalog's tour services.
import { ContentTier, newId, PlaceStatus, TourStatus, TranslationSource } from '@wayfare/contracts';
import {
  contentTierProto,
  placeStatusProto,
  tourStatusProto,
  translationSourceProto,
} from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway, deviceToken } from '../support/app';
import type { E2eApp } from '../support/app';

let gateway: E2eApp;
const server = () => gateway.app.getHttpServer();
const tourId = newId();
const areaId = newId();
const placeId = newId();
const at = toProtoTimestamp(new Date('2026-05-01T00:00:00.000Z'));
const photo = (name: string) => ({
  url: `https://media.test/${name}.jpg`,
  sha256: 'a'.repeat(64),
  bytes: 10,
  width: 4,
  height: 3,
});

const device = (path: string) =>
  request(server())
    .get(`/api/v1${path}`)
    .set('X-Wayfare-Client', 'mobile')
    .set('X-Wayfare-App-Version', '1.0.0')
    .set('Authorization', `Bearer ${deviceToken()}`);

const visitor = (path: string) =>
  request(server()).get(`/api/v1${path}`).set('X-Wayfare-Client', 'web');

function console_(method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) {
  const agent = request(server());
  return agent[method](`/api/v1${path}`)
    .set('X-Wayfare-Client', 'console')
    .set('Cookie', `wf_at=${accountToken({ perms: ['tour.manage'] })}`);
}

const text = {
  lang: 'en',
  title: 'Old Saigon',
  description: 'A walk.',
  contentTier: contentTierProto.toProto(ContentTier.REQUESTED),
  stale: false,
};
const summary = (cover: boolean) => ({
  id: tourId,
  publicCode: 'T7M2Q9XA',
  areaId,
  areaCode: 'd1',
  text,
  ...(cover ? { cover: photo('c') } : {}),
  estimatedMinutes: 40,
  distanceM: 1800,
  stopCount: 2,
});

beforeAll(async () => {
  gateway = await bootGateway();
});
afterAll(() => gateway.app.close());
beforeEach(() => {
  gateway.identity.reset();
  gateway.catalog.reset();
});

describe('GET /sync/tours', () => {
  const placeId = newId();
  const record = (cover: boolean) => ({
    id: tourId,
    publicCode: 'T7M2Q9XA',
    areaId,
    text,
    ...(cover ? { cover: photo('c') } : {}),
    estimatedMinutes: 40,
    distanceM: 1800,
    stops: [{ position: 1, placeId }],
  });

  it('serves a page tagged by area, language and version; a cover only where one exists', async () => {
    gateway.catalog.tourQueries.handlers.syncTours = () =>
      Promise.resolve({
        tours: [record(true), record(false)],
        removedTourIds: [placeId],
        datasetVersion: '9',
        complete: true,
      });
    const response = await device(`/sync/tours?areaId=${areaId}&lang=en&since=3`);
    expect(response.status).toBe(200);
    expect(response.headers.etag).toBe(`"tours:${areaId}:en:9"`);
    expect(response.body.meta).toEqual({ complete: true });
    expect(response.body.data).toMatchObject({
      datasetVersion: 9,
      removedTourIds: [placeId],
      tours: [{ cover: photo('c'), stops: [{ position: 1, placeId }] }, { cover: null }],
    });
    expect(gateway.catalog.tourQueries.calls[0]!.request).toEqual({
      areaId,
      lang: 'en',
      since: '3',
    });
  });

  it('asks from the start when the device has no version', async () => {
    gateway.catalog.tourQueries.handlers.syncTours = () =>
      Promise.resolve({ tours: [], removedTourIds: [], datasetVersion: '0', complete: true });
    expect((await device(`/sync/tours?areaId=${areaId}&lang=en`)).status).toBe(200);
    expect(gateway.catalog.tourQueries.calls[0]!.request).toMatchObject({ since: '0' });
  });
});

describe('the tourist’s tours', () => {
  it('lists an area’s tours, a cover only where one exists, with the next cursor', async () => {
    gateway.catalog.tourQueries.handlers.listTours = () =>
      Promise.resolve({ tours: [summary(true), summary(false)], page: { nextCursor: 'n1' } });
    const response = await device(`/tours?areaId=${areaId}&lang=en&cursor=c0&limit=2`);
    expect(response.status).toBe(200);
    expect((response.body.data as { cover: unknown }[]).map((tour) => tour.cover)).toEqual([
      photo('c'),
      null,
    ]);
    expect(response.body.meta).toMatchObject({ nextCursor: 'n1' });
    expect(gateway.catalog.tourQueries.calls[0]!.request).toMatchObject({
      areaId,
      lang: 'en',
      page: { limit: 2, cursor: 'c0' },
    });
  });

  it('ends the list when catalog sends no cursor, and asks with none when the tourist has none', async () => {
    gateway.catalog.tourQueries.handlers.listTours = () => Promise.resolve({ tours: [] });
    const response = await device(`/tours?areaId=${areaId}&lang=en`);
    expect(response.body.meta).toMatchObject({ nextCursor: null });
    expect(gateway.catalog.tourQueries.calls[0]!.request).toMatchObject({ page: { limit: 20 } });
  });

  it('draws a tour’s stops at their positions, a stop whose Place isn’t live as a gap', async () => {
    const detail = {
      summary: summary(true),
      cover: { thumb: photo('t'), card: photo('c'), full: photo('f') },
      stops: [
        {
          position: 1,
          legM: 0,
          place: {
            id: placeId,
            publicCode: 'K7M2Q9XA',
            categoryCode: 'MARKET',
            location: { lat: 10.77, lng: 106.7 },
            name: 'Ben Thanh',
            nameVi: 'Bến Thành',
            cardPhoto: photo('p'),
          },
        },
        {
          position: 2,
          legM: 300,
          place: {
            id: newId(),
            publicCode: 'K7M2Q9XB',
            categoryCode: 'LANDMARK',
            location: { lat: 10.78, lng: 106.7 },
            name: 'Opera',
            nameVi: 'Nhà hát',
          },
        },
        { position: 3, legM: 500 },
      ],
    };
    gateway.catalog.tourQueries.handlers.getTour = () => Promise.resolve({ tour: detail });
    const response = await visitor(`/tours/${tourId}?lang=en`);
    expect(response.status).toBe(200);
    expect(response.body.data.coverVariants).toEqual({
      thumb: photo('t'),
      card: photo('c'),
      full: photo('f'),
    });
    expect((response.body.data.stops as { place: unknown }[]).map((stop) => stop.place)).toEqual([
      expect.objectContaining({ nameVi: 'Bến Thành', cardPhoto: photo('p') }),
      expect.objectContaining({ nameVi: 'Nhà hát', cardPhoto: null }),
      null,
    ]);
  });

  it('opens a tour by its printed code, with no cover when it has none', async () => {
    gateway.catalog.tourQueries.handlers.getTourByCode = () =>
      Promise.resolve({ tour: { summary: summary(false), stops: [] } });
    const response = await visitor('/tours/by-code/T7M2Q9XA?lang=en');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ cover: null, coverVariants: null, stops: [] });
    expect(gateway.catalog.tourQueries.calls[0]!.request).toEqual({
      publicCode: 'T7M2Q9XA',
      lang: 'en',
    });
  });

  it('fails the read when catalog answers without the tour, its text, or a tier it knows', async () => {
    gateway.catalog.tourQueries.handlers.getTour = () => Promise.resolve({});
    expect((await visitor(`/tours/${tourId}?lang=en`)).status).toBe(500);
    gateway.catalog.tourQueries.handlers.getTour = () =>
      Promise.resolve({ tour: { summary: { ...summary(false), text: undefined }, stops: [] } });
    expect((await visitor(`/tours/${tourId}?lang=en`)).status).toBe(500);
    gateway.catalog.tourQueries.handlers.getTour = () =>
      Promise.resolve({
        tour: { summary: { ...summary(false), text: { ...text, contentTier: 99 } }, stops: [] },
      });
    expect((await visitor(`/tours/${tourId}?lang=en`)).status).toBe(500);
    gateway.catalog.tourQueries.handlers.getTour = () => Promise.resolve({ tour: { stops: [] } });
    expect((await visitor(`/tours/${tourId}?lang=en`)).status).toBe(500);
  });
});

const adminTour = (over: Record<string, unknown> = {}) => ({
  id: tourId,
  publicCode: 'T7M2Q9XA',
  areaId,
  areaCode: 'd1',
  titleVi: 'Sài Gòn xưa',
  descriptionVi: 'Một chuyến đi.',
  contentHash: 'h',
  estimatedMinutes: 40,
  distanceM: 1800,
  status: tourStatusProto.toProto(TourStatus.DRAFT),
  inactiveByAdmin: false,
  syncVersion: '1',
  createdById: newId(),
  createdAt: at,
  updatedAt: at,
  stops: [
    {
      position: 1,
      placeId,
      publicCode: 'K7M2Q9XA',
      nameVi: 'Bến Thành',
      nameEn: 'Ben Thanh',
      categoryCode: 'MARKET',
      status: placeStatusProto.toProto(PlaceStatus.ACTIVE),
      deleted: false,
      outsideArea: false,
      location: { lat: 10.77, lng: 106.7 },
      legM: 0,
    },
    {
      position: 2,
      placeId: newId(),
      publicCode: 'K7M2Q9XB',
      nameVi: 'Nhà hát',
      categoryCode: 'LANDMARK',
      status: placeStatusProto.toProto(PlaceStatus.DRAFT),
      deleted: false,
      outsideArea: true,
      location: { lat: 10.78, lng: 106.7 },
      legM: 300,
    },
  ],
  localizations: [
    {
      lang: 'en',
      textReady: true,
      stale: false,
      translationSource: translationSourceProto.toProto(TranslationSource.MACHINE),
    },
  ],
  activationMissing: ['activation', 'later'],
  liveStops: 1,
  hiddenFromTourists: true,
  ...over,
});

const listRow = (over: Record<string, unknown> = {}) => ({
  id: tourId,
  publicCode: 'T7M2Q9XA',
  titleVi: 'Sài Gòn xưa',
  areaId,
  areaCode: 'd1',
  status: tourStatusProto.toProto(TourStatus.ACTIVE),
  inactiveByAdmin: false,
  activationRequested: false,
  estimatedMinutes: 40,
  distanceM: 1800,
  liveStops: 2,
  totalStops: 2,
  hiddenFromTourists: false,
  updatedAt: at,
  ...over,
});

describe('/admin/tours', () => {
  it('lists with the filters given, a row’s cover and deletion only where catalog has them', async () => {
    gateway.catalog.tourAdmin.handlers.listTours = () =>
      Promise.resolve({
        tours: [listRow(), listRow({ cover: photo('c'), deletedAt: at })],
        page: { page: 2, pageSize: 10, total: 12 },
      });
    const response = await console_(
      'get',
      `/admin/tours?page=2&pageSize=10&q=sài&status=ACTIVE&areaId=${areaId}&includeDeleted=true`,
    );
    expect(response.status).toBe(200);
    expect(
      (response.body.data as { cover: unknown; deletedAt: unknown }[]).map((row) => [
        row.cover,
        row.deletedAt,
      ]),
    ).toEqual([
      [null, null],
      [photo('c'), '2026-05-01T00:00:00.000Z'],
    ]);
    expect(response.body.meta).toMatchObject({ page: 2, pageSize: 10, total: 12 });
    expect(gateway.catalog.tourAdmin.calls[0]!.request).toMatchObject({
      page: { page: 2, pageSize: 10, q: 'sài' },
      status: tourStatusProto.toProto(TourStatus.ACTIVE),
      areaId,
      includeDeleted: true,
    });
  });

  it('lists with no filters, the page from the query when catalog sends none', async () => {
    gateway.catalog.tourAdmin.handlers.listTours = () => Promise.resolve({ tours: [] });
    const response = await console_('get', '/admin/tours');
    expect(response.body.meta).toMatchObject({ page: 1, total: 0 });
    const sent = gateway.catalog.tourAdmin.calls[0]!.request as Record<string, unknown>;
    expect(sent).toMatchObject({ includeDeleted: false });
    expect(sent).not.toHaveProperty('status');
    expect(sent).not.toHaveProperty('areaId');
  });

  it('reads a tour in full: its stops, a missing English name as null, and only the gate’s known pieces', async () => {
    gateway.catalog.tourAdmin.handlers.getTourAdmin = () =>
      Promise.resolve({
        tour: adminTour({
          cover: { thumb: photo('t'), card: photo('c'), full: photo('f') },
          activationRequestedAt: at,
          deletedAt: at,
        }),
      });
    const response = await console_('get', `/admin/tours/${tourId}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      cover: { thumb: photo('t') },
      activationRequestedAt: '2026-05-01T00:00:00.000Z',
      deletedAt: '2026-05-01T00:00:00.000Z',
      activationMissing: ['activation'],
      hiddenFromTourists: true,
    });
    expect((response.body.data.stops as { nameEn: unknown }[]).map((stop) => stop.nameEn)).toEqual([
      'Ben Thanh',
      null,
    ]);
  });

  it('creates a tour with its stops, a cover upload only when given', async () => {
    gateway.catalog.tourAdmin.handlers.createTour = () => Promise.resolve({ tour: adminTour() });
    const coverUploadId = newId();
    const body = {
      titleVi: 'Sài Gòn xưa',
      descriptionVi: 'Một chuyến đi.',
      areaId,
      estimatedMinutes: 40,
      stops: [placeId],
      requestActivation: false,
    };
    const created = await console_('post', '/admin/tours').send({ ...body, coverUploadId });
    expect(created.status).toBe(201);
    expect(created.body.data.tour).toMatchObject({ id: tourId, cover: null });
    await console_('post', '/admin/tours').send(body);
    const [withCover, without] = gateway.catalog.tourAdmin.calls.map((call) => call.request);
    expect(withCover).toMatchObject({ coverUploadId, placeIds: [placeId] });
    expect(without).not.toHaveProperty('coverUploadId');
  });

  it('edits only the fields given; a null cover removes it', async () => {
    gateway.catalog.tourAdmin.handlers.updateTour = () => Promise.resolve({ tour: adminTour() });
    const coverUploadId = newId();
    await console_('patch', `/admin/tours/${tourId}`).send({
      titleVi: 'Mới',
      descriptionVi: 'Mô tả',
      estimatedMinutes: 50,
      coverUploadId,
    });
    await console_('patch', `/admin/tours/${tourId}`).send({ coverUploadId: null });
    await console_('patch', `/admin/tours/${tourId}`).send({});
    const [full, removed, nothing] = gateway.catalog.tourAdmin.calls.map((call) => call.request);
    expect(full).toEqual({
      tourId,
      titleVi: 'Mới',
      descriptionVi: 'Mô tả',
      estimatedMinutes: 50,
      coverUploadId,
      removeCover: false,
    });
    expect(removed).toEqual({ tourId, removeCover: true });
    expect(nothing).toEqual({ tourId, removeCover: false });
  });

  it('replaces the stops, asks for activation, and deactivates, deletes and restores', async () => {
    const handlers = gateway.catalog.tourAdmin.handlers;
    handlers.replaceTourStops = () => Promise.resolve({ tour: adminTour() });
    handlers.requestTourActivation = () =>
      Promise.resolve({
        status: tourStatusProto.toProto(TourStatus.DRAFT),
        missing: ['en.text', 'unknown'],
      });
    handlers.deactivateTour = () => Promise.resolve({ tour: adminTour() });
    handlers.deleteTour = () => Promise.resolve({});
    handlers.restoreTour = () => Promise.resolve({ tour: adminTour() });
    expect(
      (await console_('put', `/admin/tours/${tourId}/stops`).send({ stops: [placeId] })).status,
    ).toBe(200);
    const activation = await console_('post', `/admin/tours/${tourId}/activate`);
    expect(activation.body.data).toEqual({ status: TourStatus.DRAFT, missing: ['en.text'] });
    expect((await console_('post', `/admin/tours/${tourId}/deactivate`)).status).toBe(200);
    expect((await console_('delete', `/admin/tours/${tourId}`)).status).toBe(204);
    expect((await console_('post', `/admin/tours/${tourId}/restore`)).status).toBe(200);
    expect(gateway.catalog.tourAdmin.calls.map((call) => call.method)).toEqual([
      'replaceTourStops',
      'requestTourActivation',
      'deactivateTour',
      'deleteTour',
      'restoreTour',
    ]);
    expect(gateway.catalog.tourAdmin.calls[0]!.request).toEqual({ tourId, placeIds: [placeId] });
  });

  it('serves the sticker as SVG, for the QR base it is configured with', async () => {
    gateway.catalog.tourAdmin.handlers.getTourQr = () => Promise.resolve({ svg: '<svg/>' });
    const response = await console_('get', `/admin/tours/${tourId}/qr`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(gateway.catalog.tourAdmin.calls[0]!.request).toMatchObject({ tourId });
  });

  it('fails a read whose tour is missing, or whose status catalog doesn’t know', async () => {
    gateway.catalog.tourAdmin.handlers.getTourAdmin = () => Promise.resolve({});
    expect((await console_('get', `/admin/tours/${tourId}`)).status).toBe(500);
    gateway.catalog.tourAdmin.handlers.getTourAdmin = () =>
      Promise.resolve({ tour: adminTour({ status: 99 }) });
    expect((await console_('get', `/admin/tours/${tourId}`)).status).toBe(500);
  });
});
