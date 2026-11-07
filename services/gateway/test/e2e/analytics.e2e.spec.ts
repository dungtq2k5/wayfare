// Analytics through the gateway (api-endpoints-plan §7): the tourist's consent and events reach
// analytics with an anonymous caller (ADR 0042); a coordinate refuses the batch; the runtime lane
// counts a known Area only, once per 15 minutes; the owner's stats at their plan's depth, the
// export at FULL; the admin's overview, top Places, heatmap and runtime activity.
import { status } from '@grpc/grpc-js';
import { newId, runtimeKey } from '@wayfare/contracts';
import { analyticsGrpc, billingGrpc, catalogGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway, deviceToken, serviceError } from '../support/app';
import type { E2eApp } from '../support/app';

let gateway: E2eApp;
const ownerId = newId();
const owner = () =>
  `wf_at=${accountToken({ userId: ownerId, ov: true, ev: true, perms: ['owner.access'] })}`;
const staff = (perms: string[]) => `wf_at=${accountToken({ userId: newId(), perms })}`;
const post = (path: string, body: object, deviceId: string = newId(), client = 'mobile') =>
  request(gateway.app.getHttpServer())
    .post(`/api/v1${path}`)
    .set('X-Wayfare-Client', client)
    .set('X-Wayfare-App-Version', '0.4.1')
    .set('Authorization', `Bearer ${deviceToken(deviceId)}`)
    .send(body);
const get = (path: string, cookie: string) =>
  request(gateway.app.getHttpServer())
    .get(`/api/v1${path}`)
    .set('X-Wayfare-Client', 'console')
    .set('Cookie', cookie);

const analyticsDeviceId = newId();
const event = (fields: Record<string, unknown> = {}) => ({
  id: newId(),
  sessionId: newId(),
  type: 'APP_OPENED',
  occurredAt: '2026-11-07T10:00:00.000Z',
  ...fields,
});

beforeAll(async () => {
  gateway = await bootGateway();
});
afterAll(() => gateway.app.close());
beforeEach(() => {
  gateway.catalog.reset();
  gateway.billing.reset();
  gateway.analytics.reset();
  gateway.redis.values.clear();
  gateway.redis.sets.clear();
});

describe('the tourist’s writes', () => {
  it('forwards a consent with an anonymous caller: no device id, no address', async () => {
    gateway.analytics.events.handlers.recordConsent = () => Promise.resolve({});
    const res = await post('/analytics/consent', {
      analyticsDeviceId,
      state: 'GRANTED',
      policyVersion: '2026-09-01',
    });
    expect(res.status).toBe(204);
    const [call] = gateway.analytics.events.calls;
    expect(call!.request).toEqual({
      analyticsDeviceId,
      state: analyticsGrpc.ConsentState.CONSENT_STATE_GRANTED,
      policyVersion: '2026-09-01',
    });
    expect(call!.context).toEqual({ kind: 'anonymous', origin: { ip: null, userAgent: null } });
  });

  it('passes analytics’ refusal of an outdated grant through as 409', async () => {
    gateway.analytics.events.handlers.recordConsent = () =>
      Promise.reject(
        serviceError(status.FAILED_PRECONDITION, {
          'wf-error-code': 'LEGAL_VERSION_OUTDATED',
          'wf-error-details': JSON.stringify({
            document: 'PRIVACY_POLICY',
            currentVersion: '2026-09-01',
          }),
        }),
      );
    const res = await post('/analytics/consent', {
      analyticsDeviceId,
      state: 'GRANTED',
      policyVersion: '2025-01-01',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LEGAL_VERSION_OUTDATED');
  });

  it('forwards a batch with the platform and build from the headers, anonymously', async () => {
    gateway.analytics.events.handlers.ingestEvents = () =>
      Promise.resolve({ stored: 2, duplicates: 0, dropped: 0 });
    const events = [event(), event({ type: 'PLACE_OPENED', placeId: newId(), cell: 'w3gv2cp' })];
    const res = await post('/analytics/events', { analyticsDeviceId, events });
    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ stored: 2, duplicates: 0, dropped: 0 });
    const [call] = gateway.analytics.events.calls;
    expect(call!.request).toEqual({
      analyticsDeviceId,
      eventsJson: events.map((sent) => JSON.stringify(sent)),
      platform: 'ANDROID',
      appVersion: '0.4.1',
    });
    expect(call!.context.kind).toBe('anonymous');
    await post('/analytics/events', { analyticsDeviceId, events }, newId(), 'web');
    expect(gateway.analytics.events.calls[1]!.request).toMatchObject({ platform: 'WEB' });
  });

  it('refuses a whole batch with a coordinate anywhere, without calling analytics', async () => {
    const res = await post('/analytics/events', {
      analyticsDeviceId,
      events: [event(), event({ props: { where: { latitude: 10.76 } } })],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(gateway.analytics.events.calls).toHaveLength(0);
  });

  it('refuses more than 100 events', async () => {
    const res = await post('/analytics/events', {
      analyticsDeviceId,
      events: Array.from({ length: 101 }, () => event()),
    });
    expect(res.status).toBe(400);
  });

  it('passes CONSENT_REQUIRED through as 403', async () => {
    gateway.analytics.events.handlers.ingestEvents = () =>
      Promise.reject(
        serviceError(status.PERMISSION_DENIED, { 'wf-error-code': 'CONSENT_REQUIRED' }),
      );
    const res = await post('/analytics/events', { analyticsDeviceId, events: [event()] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CONSENT_REQUIRED');
  });
});

describe('the consent-free runtime lane', () => {
  const areaId = newId();

  beforeEach(() => {
    gateway.catalog.placeQueries.handlers.listAreas = () =>
      Promise.resolve({ areas: [{ id: areaId, code: 'hcmc-d1-core' }] });
  });

  it('adds the install to its live Area’s hour, once per 15 minutes, and stores nothing else', async () => {
    const deviceId = newId();
    const first = await post('/telemetry/activity', { areaId }, deviceId);
    expect(first.status).toBe(204);
    const counter = gateway.redis.sets.get(runtimeKey(areaId, new Date()));
    expect([...(counter ?? [])]).toEqual([deviceId]);
    expect(gateway.redis.expiries.get(runtimeKey(areaId, new Date()))).toBe(7200);
    expect(gateway.analytics.events.calls).toHaveLength(0);
    const second = await post('/telemetry/activity', { areaId }, deviceId);
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('RATE_LIMITED');
  });

  it('doesn’t count an Area the gateway doesn’t serve', async () => {
    const res = await post('/telemetry/activity', { areaId: newId() });
    expect(res.status).toBe(204);
    expect(gateway.redis.sets.size).toBe(0);
  });
});

describe('/owner/stats', () => {
  const [venueA, venueB] = [newId(), newId()];
  const range = '?from=2026-11-01&to=2026-11-03';
  const level = (analyticsLevel: billingGrpc.AnalyticsLevel) => {
    gateway.billing.entitlements.handlers.getEntitlements = () =>
      Promise.resolve({ entitlementsVersion: '1', entitlements: { analyticsLevel } });
  };
  const row = (placeId: string, day: string, started: number) => ({
    placeId,
    day,
    narrationsStarted: started,
    narrationsCompleted: started - 1,
    narrationsAbandoned: 1,
    geofenceStarted: started - 1,
    tapStarted: 1,
    qrStarted: 0,
    listenMsSum: String(started * 60_000),
    listenCount: started,
    opens: 2,
  });

  beforeEach(() => {
    gateway.catalog.ownerPlaces.handlers.listMyPlaces = () =>
      Promise.resolve({
        places: [
          { id: venueB, nameVi: 'Quán B', status: catalogGrpc.PlaceStatus.PLACE_STATUS_INACTIVE },
          { id: venueA, nameVi: 'Quán A', status: catalogGrpc.PlaceStatus.PLACE_STATUS_ACTIVE },
        ],
      });
    gateway.analytics.reads.handlers.getPlaceDailyStats = () =>
      Promise.resolve({
        days: [row(venueA, '2026-11-01', 4), row(venueB, '2026-11-02', 2)],
        dataThrough: '2026-11-02',
      });
    gateway.catalog.insights.handlers.getQrScans = () =>
      Promise.resolve({ days: [{ placeId: venueA, day: '2026-11-03', scans: 3 }] });
  });

  it('at BASIC: the four figures and the series — the FULL fields absent, not zero', async () => {
    level(billingGrpc.AnalyticsLevel.ANALYTICS_LEVEL_BASIC);
    const res = await get(`/owner/stats/places${range}`, owner());
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data).toMatchObject({ analyticsLevel: 'BASIC', dataThrough: '2026-11-02' });
    expect(data.totals).toEqual({
      narrationsStarted: 6,
      narrationsCompleted: 4,
      completionRate: 4 / 6,
      averageListenMs: 60_000,
      qrScans: 3,
    });
    expect(data.days).toEqual([
      { day: '2026-11-01', narrationsStarted: 4 },
      { day: '2026-11-02', narrationsStarted: 2 },
      { day: '2026-11-03', narrationsStarted: 0 },
    ]);
    // The Venues the owner owns now, by name; an inactive one included.
    expect((data.venues as { name: string }[]).map((venue) => venue.name)).toEqual([
      'Quán A',
      'Quán B',
    ]);
    expect(data.venues[1]).toMatchObject({ status: 'INACTIVE', totals: { qrScans: 0 } });
    const [stats] = gateway.analytics.reads.calls;
    expect(stats!.request).toEqual({
      placeIds: [venueA, venueB],
      range: { fromDay: '2026-11-01', toDay: '2026-11-03' },
    });
  });

  it('at FULL: stopped early, page opens and how each story started, per day too', async () => {
    level(billingGrpc.AnalyticsLevel.ANALYTICS_LEVEL_FULL);
    const res = await get(`/owner/stats/places/${venueA}${range}`, owner());
    expect(res.status).toBe(200);
    expect(res.body.data.totals).toEqual({
      narrationsStarted: 4,
      narrationsCompleted: 3,
      completionRate: 0.75,
      averageListenMs: 60_000,
      qrScans: 3,
      narrationsAbandoned: 1,
      opens: 2,
      startedBy: { walkingBy: 3, tapping: 1, scanning: 0 },
    });
    expect(res.body.data.days[0]).toEqual({
      day: '2026-11-01',
      narrationsStarted: 4,
      startedBy: { walkingBy: 3, tapping: 1, scanning: 0 },
    });
  });

  it('refuses NONE with 403, another owner’s Venue with 404, and 94 days with 400', async () => {
    level(billingGrpc.AnalyticsLevel.ANALYTICS_LEVEL_NONE);
    const none = await get(`/owner/stats/places${range}`, owner());
    expect(none.status).toBe(403);
    expect(none.body.error.code).toBe('ANALYTICS_LEVEL_INSUFFICIENT');
    level(billingGrpc.AnalyticsLevel.ANALYTICS_LEVEL_FULL);
    const foreign = await get(`/owner/stats/places/${newId()}${range}`, owner());
    expect(foreign.status).toBe(404);
    const long = await get('/owner/stats/places?from=2026-08-01&to=2026-11-02', owner());
    expect(long.status).toBe(400);
    expect(long.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('exports the CSV at FULL only: a BOM, the file name, one row per Venue per day', async () => {
    level(billingGrpc.AnalyticsLevel.ANALYTICS_LEVEL_BASIC);
    const basic = await get(`/owner/stats/export${range}`, owner());
    expect(basic.status).toBe(403);
    expect(basic.body.error.code).toBe('ANALYTICS_LEVEL_INSUFFICIENT');
    level(billingGrpc.AnalyticsLevel.ANALYTICS_LEVEL_FULL);
    const res = await get(`/owner/stats/export${range}&lang=vi`, owner()).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="wayfare-stats-2026-11-01-2026-11-03.csv"',
    );
    const text = res.text;
    expect(text.startsWith('﻿Ngày,Địa điểm,Lượt thuyết minh,')).toBe(true);
    const lines = text.trim().split('\r\n');
    expect(lines).toHaveLength(1 + 3 * 2);
    expect(lines[1]).toBe('2026-11-01,Quán A,4,3,1,3,1,0,60,2,0');
    expect(lines[2]).toBe('2026-11-01,Quán B,0,0,0,0,0,0,,0,0');
    expect(lines[5]).toBe('2026-11-03,Quán A,0,0,0,0,0,0,,0,3');
  });
});

describe('/admin/analytics', () => {
  const admin = () => staff(['analytics.read']);
  const range = '?from=2026-11-01&to=2026-11-02';

  it('needs analytics.read', async () => {
    const res = await get(`/admin/analytics/overview${range}`, staff(['place.read']));
    expect(res.status).toBe(403);
  });

  it('the overview: totals and days, QR scans from catalog’s counts', async () => {
    const day = (date: string, started: number) => ({
      day: date,
      sessions: 10,
      activeDevicesEstimate: 6,
      packInstalls: 1,
      searches: 0,
      narrationsStarted: started,
      narrationsCompleted: started - 1,
      geofenceStarted: started - 1,
      tapStarted: 1,
      qrStarted: 0,
      tier1Narrations: started - 1,
      tier15Narrations: 0,
      tier2Narrations: 0,
      tier3Narrations: 1,
    });
    gateway.analytics.reads.handlers.getOverview = () =>
      Promise.resolve({
        days: [day('2026-11-01', 5), day('2026-11-02', 3)],
        languages: [{ lang: 'en', narrationsStarted: 6, narrationsCompleted: 4 }],
        dataThrough: '2026-11-02',
      });
    gateway.catalog.insights.handlers.getQrScans = () =>
      Promise.resolve({ days: [{ placeId: '', day: '2026-11-02', scans: 7 }] });
    const res = await get(`/admin/analytics/overview${range}`, admin());
    expect(res.status).toBe(200);
    expect(res.body.data.totals).toEqual({
      sessions: 20,
      narrationsStarted: 8,
      narrationsCompleted: 6,
      completionRate: 0.75,
      byTrigger: { walkingBy: 6, tapping: 2, scanning: 0 },
      byTier: { t1: 6, t1_5: 0, t2: 0, t3: 2 },
      packInstalls: 2,
      qrScans: 7,
      activeDevicesEstimate: 6,
    });
    expect(res.body.data.days[1]).toMatchObject({ day: '2026-11-02', qrScans: 7 });
    expect(gateway.catalog.insights.calls[0]!.request).toEqual({
      placeIds: [],
      fromDay: '2026-11-01',
      toDay: '2026-11-02',
    });
  });

  it('top Places: twice the limit asked, a deleted Place dropped, the list still limit long', async () => {
    const ids = [newId(), newId(), newId(), newId()];
    gateway.analytics.reads.handlers.getTopPlaces = () =>
      Promise.resolve({
        places: ids.map((placeId, index) => ({
          placeId,
          narrationsStarted: 10 - index,
          narrationsCompleted: 9 - index,
          listenMsSum: '1000',
        })),
        dataThrough: '2026-11-02',
      });
    gateway.catalog.places.handlers.batchGetPlaceSummaries = () =>
      Promise.resolve({
        places: [ids[1], ids[2], ids[3]].map((id) => ({
          id,
          nameVi: `Nơi ${id!.slice(-4)}`,
          status: catalogGrpc.PlaceStatus.PLACE_STATUS_ACTIVE,
        })),
      });
    const res = await get(`/admin/analytics/places/top${range}&limit=2&metric=started`, admin());
    expect(res.status).toBe(200);
    expect(gateway.analytics.reads.calls[0]!.request).toMatchObject({
      limit: 4,
      metric: analyticsGrpc.TopPlacesMetric.TOP_PLACES_METRIC_STARTED,
    });
    expect((res.body.data.places as { placeId: string }[]).map((place) => place.placeId)).toEqual([
      ids[1],
      ids[2],
    ]);
  });

  it('the heatmap: the band converted to UTC, the Area’s box, squares as polygons, ten labelled', async () => {
    const areaId = newId();
    gateway.catalog.placeQueries.handlers.listAreas = () =>
      Promise.resolve({
        areas: [
          {
            id: areaId,
            code: 'hcmc-d4-vinh-khanh',
            boundaryGeojson: JSON.stringify({
              type: 'Polygon',
              coordinates: [
                [
                  [106.69, 10.75],
                  [106.71, 10.75],
                  [106.71, 10.77],
                  [106.69, 10.75],
                ],
              ],
            }),
          },
        ],
      });
    const cells = Array.from({ length: 12 }, (_, index) => ({
      cell: `w3gv2c${'0123456789bc'[index]}`,
      estimate: 50 - index,
    }));
    gateway.analytics.reads.handlers.getHeatmap = () =>
      Promise.resolve({
        cells,
        computedThrough: toProtoTimestamp(new Date('2026-11-03T10:05:00Z')),
      });
    gateway.catalog.insights.handlers.nearestLivePlaces = () =>
      Promise.resolve({ places: [{ index: 0, placeId: newId(), nameVi: 'Quán Ốc Oanh' }] });
    const res = await get(`/admin/analytics/heatmap${range}&areaId=${areaId}&hours=22-24`, admin());
    expect(res.status).toBe(200);
    expect(gateway.analytics.reads.calls[0]!.request).toMatchObject({
      utcHours: [15, 16],
      minLat: 10.75,
      maxLat: 10.77,
      minLng: 106.69,
      maxLng: 106.71,
    });
    const features = res.body.data.cells.features;
    expect(features).toHaveLength(12);
    expect(features[0].properties).toEqual({
      cell: 'w3gv2c0',
      estimate: 50,
      label: 'Quán Ốc Oanh',
    });
    expect(features[1].properties).toEqual({ cell: 'w3gv2c1', estimate: 49, label: null });
    expect(features[11].properties).toEqual({ cell: 'w3gv2cc', estimate: 39 });
    expect(features[0].geometry.coordinates[0]).toHaveLength(5);
    expect(gateway.catalog.insights.calls[0]!.request).toMatchObject({ radiusM: 300 });
    const unknown = await get(`/admin/analytics/heatmap${range}&areaId=${newId()}`, admin());
    expect(unknown.status).toBe(404);
  });

  it('runtime activity: an Area’s hours, or this hour so far for every live Area', async () => {
    const areaId = newId();
    gateway.analytics.reads.handlers.getRuntimeActivity = () =>
      Promise.resolve({
        hours: [{ hourStart: toProtoTimestamp(new Date('2026-11-07T09:00:00Z')), estimate: 12 }],
      });
    const hours = await get(`/admin/analytics/runtime-activity?areaId=${areaId}&hours=48`, admin());
    expect(hours.body.data).toEqual({
      hours: [{ hourStart: '2026-11-07T09:00:00.000Z', estimate: 12 }],
    });
    expect(gateway.analytics.reads.calls[0]!.request).toEqual({ areaId, hours: 48 });
    gateway.catalog.placeQueries.handlers.listAreas = () =>
      Promise.resolve({
        areas: [{ id: areaId, code: 'hcmc-d1-core', nameVi: 'Trung tâm Quận 1' }],
      });
    gateway.analytics.reads.handlers.getCurrentActivity = () =>
      Promise.resolve({
        hourStart: toProtoTimestamp(new Date('2026-11-07T10:00:00Z')),
        areas: [{ areaId, estimate: 7 }],
      });
    const now = await get('/admin/analytics/runtime-activity?current=true', admin());
    expect(now.body.data).toEqual({
      current: {
        hourStart: '2026-11-07T10:00:00.000Z',
        areas: [{ areaId, code: 'hcmc-d1-core', name: 'Trung tâm Quận 1', estimate: 7 }],
      },
    });
    const missing = await get('/admin/analytics/runtime-activity', admin());
    expect(missing.status).toBe(400);
  });
});
