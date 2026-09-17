import { status } from '@grpc/grpc-js';
import { compareStrings, newId } from '@wayfare/contracts';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway, deviceToken, serviceError } from '../support/app';
import type { E2eApp } from '../support/app';

const body = {
  platform: 'ANDROID',
  appVersion: '0.1.0',
  contentLocale: 'en',
  privacyPolicyVersion: '2026-09-01',
};

let gateway: E2eApp;
const server = () => gateway.app.getHttpServer();

beforeAll(async () => {
  gateway = await bootGateway();
});

afterAll(() => gateway.app.close());

beforeEach(() => {
  gateway.identity.reset();
  gateway.redis.values.clear();
  gateway.redis.failure = null;
  gateway.redis.healthy = true;
  gateway.identity.devices.handlers.registerDevice = () =>
    Promise.resolve({
      deviceId: '01a0aa49-c07f-715b-bbe1-35ea926e0980',
      deviceSecret: 's3cret',
      accessToken: 'tok',
      expiresIn: 900,
    });
});

const post = () => request(server()).post('/api/v1/devices');

describe('POST /api/v1/devices', () => {
  it('registers a device: 201, enveloped, never cached', async () => {
    const res = await post()
      .set('X-Wayfare-Client', 'mobile')
      .set('X-Forwarded-For', '198.51.100.7')
      .send(body);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      data: {
        deviceId: '01a0aa49-c07f-715b-bbe1-35ea926e0980',
        deviceSecret: 's3cret',
        accessToken: 'tok',
        expiresIn: 900,
      },
    });
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('maps the body to proto and passes the OBSERVED origin, not a claimed one', async () => {
    await post()
      .set('X-Wayfare-Client', 'mobile')
      .set('User-Agent', 'Wayfare/1.0')
      .set('X-Forwarded-For', '198.51.100.7')
      .send(body);
    const [call] = gateway.identity.devices.calls;
    expect(call?.request).toEqual({
      platform: identityGrpc.Platform.PLATFORM_ANDROID,
      appVersion: '0.1.0',
      contentLocale: 'en',
      privacyPolicyVersion: '2026-09-01',
    });
    // TRUST_PROXY_HOPS=1: exactly one hop is trusted, so X-Forwarded-For's last entry is the client.
    expect(call?.context).toEqual({
      kind: 'anonymous',
      origin: { ip: '198.51.100.7', userAgent: 'Wayfare/1.0' },
    });
  });

  it('refuses a request without X-Wayfare-Client before touching identity', async () => {
    const res = await post().send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CLIENT_HEADER_REQUIRED');
    expect(res.body.error.requestId).toEqual(expect.any(String));
    expect(gateway.identity.devices.calls).toHaveLength(0);
  });

  it('refuses an unknown client kind', async () => {
    const res = await post().set('X-Wayfare-Client', 'desktop').send(body);
    expect(res.body.error.code).toBe('CLIENT_HEADER_REQUIRED');
  });

  it('refuses an UNKNOWN field instead of silently dropping it', async () => {
    const res = await post()
      .set('X-Wayfare-Client', 'web')
      .send({ ...body, narrationPriority: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { issues: [{ path: '', code: 'unrecognized_keys' }] },
    });
  });

  it('refuses an unknown platform with a JSON-pointer path', async () => {
    const res = await post()
      .set('X-Wayfare-Client', 'web')
      .send({ ...body, platform: 'PC' });
    expect(res.body.error.details.issues).toEqual([{ path: '/platform', code: 'invalid_value' }]);
  });

  it('answers 400 MALFORMED_REQUEST for a body that is not JSON', async () => {
    const res = await post()
      .set('X-Wayfare-Client', 'web')
      .set('Content-Type', 'application/json')
      .send('{oops');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_REQUEST');
  });

  it('answers 503 UPSTREAM_UNAVAILABLE with Retry-After when identity is down', async () => {
    gateway.identity.devices.handlers.registerDevice = () =>
      Promise.reject(serviceError(status.UNAVAILABLE));
    const res = await post().set('X-Wayfare-Client', 'mobile').send(body);
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    expect(res.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('answers 504 UPSTREAM_TIMEOUT when identity is too slow', async () => {
    gateway.identity.devices.handlers.registerDevice = () =>
      Promise.reject(serviceError(status.DEADLINE_EXCEEDED));
    const res = await post().set('X-Wayfare-Client', 'mobile').send(body);
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('UPSTREAM_TIMEOUT');
  });

  it("passes identity's error code and details through", async () => {
    gateway.identity.devices.handlers.registerDevice = () =>
      Promise.reject(
        serviceError(status.FAILED_PRECONDITION, {
          'wf-error-code': 'LEGAL_VERSION_OUTDATED',
          'wf-error-details': '{"document":"PRIVACY_POLICY","currentVersion":"2026-09-01"}',
        }),
      );
    const res = await post().set('X-Wayfare-Client', 'mobile').send(body);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'LEGAL_VERSION_OUTDATED',
      details: { document: 'PRIVACY_POLICY' },
    });
  });

  it('is limited per IP: the eleventh registration in an hour is 429 with Retry-After', async () => {
    for (let n = 0; n < 10; n++) {
      expect(
        (
          await post()
            .set('X-Wayfare-Client', 'mobile')
            .set('X-Forwarded-For', '198.51.100.8')
            .send(body)
        ).status,
      ).toBe(201);
    }
    const res = await post()
      .set('X-Wayfare-Client', 'mobile')
      .set('X-Forwarded-For', '198.51.100.8')
      .send(body);
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSeconds: 3600 },
    });
    expect(res.headers['retry-after']).toBe('3600');
  });

  it('never serves an unversioned or v2 path', async () => {
    expect(
      (await request(server()).post('/api/devices').set('X-Wayfare-Client', 'web').send(body))
        .status,
    ).toBe(404);
    const res = await request(server())
      .post('/api/v2/devices')
      .set('X-Wayfare-Client', 'web')
      .send(body);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});

describe('the other device routes', () => {
  const deviceId = newId();

  it('exchanges a secret: 200, never cached', async () => {
    gateway.identity.devices.handlers.exchangeDeviceToken = () =>
      Promise.resolve({ accessToken: 'fresh', expiresIn: 900 });
    const res = await request(server())
      .post('/api/v1/devices/token')
      .set('X-Wayfare-Client', 'mobile')
      .send({ deviceId, deviceSecret: 's3cret' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ accessToken: 'fresh', expiresIn: 900 });
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('updates the calling device with a device bearer, and refuses anonymous callers', async () => {
    gateway.identity.devices.handlers.updateDevice = () =>
      Promise.resolve({ device: { deviceId, appVersion: '1.1.0', contentLocale: 'ja' } });
    const res = await request(server())
      .patch('/api/v1/devices/me')
      .set('X-Wayfare-Client', 'mobile')
      .set('Authorization', `Bearer ${deviceToken(deviceId)}`)
      .send({ appVersion: '1.1.0', contentLocale: 'ja' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      deviceId,
      appVersion: '1.1.0',
      osVersion: null,
      contentLocale: 'ja',
    });
    expect(gateway.identity.devices.calls[0]?.context).toMatchObject({ kind: 'device', deviceId });

    const anonymous = await request(server())
      .patch('/api/v1/devices/me')
      .set('X-Wayfare-Client', 'mobile')
      .send({});
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('forgets the device: 204 with no body', async () => {
    gateway.identity.devices.handlers.forgetDevice = () => Promise.resolve({});
    const res = await request(server())
      .delete('/api/v1/devices/me')
      .set('X-Wayfare-Client', 'mobile')
      .set('Authorization', `Bearer ${deviceToken(deviceId)}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
  });

  it('records a device acceptance for a signed-in phone', async () => {
    gateway.identity.users.handlers.recordLegalAcceptance = () =>
      Promise.resolve({
        acceptance: {
          party: identityGrpc.LegalParty.LEGAL_PARTY_DEVICE,
          document: identityGrpc.LegalDocument.LEGAL_DOCUMENT_PRIVACY_POLICY,
          version: '2026-09-01',
          acceptedAt: toProtoTimestamp(new Date('2026-09-17T00:00:00.000Z')),
          current: true,
        },
      });
    const res = await request(server())
      .post('/api/v1/devices/me/legal-acceptances')
      .set('X-Wayfare-Client', 'mobile')
      .set('Authorization', `Bearer ${accountToken({ deviceId })}`)
      .send({ document: 'PRIVACY_POLICY', version: '2026-09-01' });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      party: 'DEVICE',
      document: 'PRIVACY_POLICY',
      version: '2026-09-01',
      acceptedAt: '2026-09-17T00:00:00.000Z',
    });
    expect(gateway.identity.users.calls[0]?.request).toEqual({
      party: identityGrpc.LegalParty.LEGAL_PARTY_DEVICE,
      document: identityGrpc.LegalDocument.LEGAL_DOCUMENT_PRIVACY_POLICY,
      version: '2026-09-01',
    });
  });
});

describe('ops routes', () => {
  it('are public, unwrapped and never rate-limited', async () => {
    for (let n = 0; n < 130; n++) {
      const res = await request(server()).get('/health').set('X-Forwarded-For', '198.51.100.9');
      expect(res.status).toBe(200);
    }
    const keys = [...gateway.redis.values.keys()].toSorted(compareStrings);
    expect(keys).toEqual([]);
  });
});
