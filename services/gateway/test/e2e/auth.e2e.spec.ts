import { status } from '@grpc/grpc-js';
import { newId } from '@wayfare/contracts';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { revokedFamilyKey, tokenCutoffKey } from '@wayfare/nest-common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway, deviceToken, serviceError, stubSession } from '../support/app';
import type { E2eApp } from '../support/app';

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
  const session = stubSession();
  for (const method of ['register', 'login', 'refresh'] as const) {
    gateway.identity.auth.handlers[method] = () => Promise.resolve({ session });
  }
  gateway.identity.auth.handlers.logout = () => Promise.resolve({});
  gateway.identity.auth.handlers.logoutAll = () => Promise.resolve({});
  gateway.identity.auth.handlers.claimDevice = () => Promise.resolve({});
});

const credentials = { email: 'ann@example.com', password: 'correct horse battery' };
const registration = { ...credentials, preferredLocale: 'en', termsVersion: '2026-09-01' };

function cookiesOf(res: request.Response): string[] {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header ?? [];
}

describe('sessions per client', () => {
  it.each(['console', 'web'])('gives %s cookies and a body with no token', async (client) => {
    const res = await request(server())
      .post('/api/v1/auth/register')
      .set('X-Wayfare-Client', client)
      .send(registration);
    expect(res.status).toBe(201);
    expect(Object.keys(res.body.data)).toEqual(['user']);
    expect(JSON.stringify(res.body)).not.toContain('refresh-token');
    const cookies = cookiesOf(res);
    expect(cookies.find((c) => c.startsWith('wf_at=access-token'))).toMatch(
      /Path=\/; .*HttpOnly; Secure; SameSite=Lax/,
    );
    expect(cookies.find((c) => c.startsWith('wf_rt=refresh-token'))).toMatch(
      /Path=\/api; .*HttpOnly; Secure; SameSite=Lax/,
    );
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(gateway.identity.auth.calls[0]?.request).toMatchObject({
      email: 'ann@example.com',
      client:
        client === 'console'
          ? identityGrpc.SessionClient.SESSION_CLIENT_CONSOLE
          : identityGrpc.SessionClient.SESSION_CLIENT_WEB,
    });
  });

  it('gives mobile the tokens in the body and no cookies', async () => {
    const res = await request(server())
      .post('/api/v1/auth/login')
      .set('X-Wayfare-Client', 'mobile')
      .send(credentials);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 1800,
    });
    expect(cookiesOf(res)).toEqual([]);
  });

  it('refreshes a cookie client from its cookie, ignoring a body token', async () => {
    const res = await request(server())
      .post('/api/v1/auth/refresh')
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', 'wf_rt=from-cookie')
      .send({ refreshToken: 'from-body' });
    expect(res.status).toBe(200);
    expect(gateway.identity.auth.calls[0]?.request).toMatchObject({ refreshToken: 'from-cookie' });
  });

  it('refreshes mobile from its body', async () => {
    const res = await request(server())
      .post('/api/v1/auth/refresh')
      .set('X-Wayfare-Client', 'mobile')
      .send({ refreshToken: 'from-body' });
    expect(res.status).toBe(200);
    expect(gateway.identity.auth.calls[0]?.request).toMatchObject({ refreshToken: 'from-body' });
  });

  it('clears the cookies on a 401 refresh, and keeps them on a 409 race', async () => {
    gateway.identity.auth.handlers.refresh = () =>
      Promise.reject(serviceError(status.UNAUTHENTICATED, { 'wf-error-code': 'UNAUTHENTICATED' }));
    const unauthenticated = await request(server())
      .post('/api/v1/auth/refresh')
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', 'wf_rt=spent');
    expect(unauthenticated.status).toBe(401);
    expect(cookiesOf(unauthenticated).some((c) => c.startsWith('wf_rt=;'))).toBe(true);

    gateway.identity.auth.handlers.refresh = () =>
      Promise.reject(
        serviceError(status.FAILED_PRECONDITION, {
          'wf-error-code': 'INVALID_STATE',
          'wf-error-details': '{"status":"ROTATED"}',
        }),
      );
    const race = await request(server())
      .post('/api/v1/auth/refresh')
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', 'wf_rt=racing');
    expect(race.status).toBe(409);
    expect(race.body.error.details).toEqual({ status: 'ROTATED' });
    expect(cookiesOf(race)).toEqual([]);
  });

  it('answers 401 for a refresh without a token', async () => {
    const res = await request(server())
      .post('/api/v1/auth/refresh')
      .set('X-Wayfare-Client', 'console');
    expect(res.status).toBe(401);
    expect(gateway.identity.auth.calls).toHaveLength(0);
  });
});

describe('logout', () => {
  it('works with an expired access token, by the refresh cookie, and clears the cookies', async () => {
    const expired = accountToken({}, new Date(Date.now() - 3_600_000));
    const res = await request(server())
      .post('/api/v1/auth/logout')
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', `wf_at=${expired}; wf_rt=still-valid`);
    expect(res.status).toBe(204);
    expect(gateway.identity.auth.calls[0]).toMatchObject({
      request: { refreshToken: 'still-valid' },
      context: { kind: 'anonymous' },
    });
    expect(cookiesOf(res).some((c) => c.startsWith('wf_at=;'))).toBe(true);
  });

  it('clears the cookies even when identity fails', async () => {
    gateway.identity.auth.handlers.logout = () => Promise.reject(serviceError(status.UNAVAILABLE));
    const res = await request(server())
      .post('/api/v1/auth/logout')
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', 'wf_rt=x');
    expect(res.status).toBe(503);
    expect(cookiesOf(res).some((c) => c.startsWith('wf_rt=;'))).toBe(true);
  });

  it('logs out everywhere for an account and clears cookies', async () => {
    const res = await request(server())
      .post('/api/v1/auth/logout/all')
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', `wf_at=${accountToken()}`);
    expect(res.status).toBe(204);
    expect(gateway.identity.auth.calls.map((call) => call.method)).toEqual([
      'getTokenCutoff',
      'logoutAll',
    ]);
  });
});

describe('the auth markers at the edge', () => {
  it('passes the device of a signed-in web install to a claim', async () => {
    const deviceId = newId();
    const res = await request(server())
      .post('/api/v1/auth/devices/claim')
      .set('X-Wayfare-Client', 'web')
      .set('Cookie', `wf_at=${accountToken()}`)
      .set('Authorization', `Bearer ${deviceToken(deviceId)}`);
    expect(res.status).toBe(204);
    expect(gateway.identity.auth.calls.at(-1)?.context).toMatchObject({
      kind: 'account',
      deviceId,
    });
  });

  it('refuses a claim without a device', async () => {
    const res = await request(server())
      .post('/api/v1/auth/devices/claim')
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', `wf_at=${accountToken()}`);
    expect(res.status).toBe(401);
  });

  it('lets a stale cookie plus a valid device bearer reach login as a device', async () => {
    const deviceId = newId();
    const sessionId = newId();
    gateway.redis.values.set(revokedFamilyKey(sessionId), '1');
    const res = await request(server())
      .post('/api/v1/auth/login')
      .set('X-Wayfare-Client', 'web')
      .set('Cookie', `wf_at=${accountToken({ sessionId })}`)
      .set('Authorization', `Bearer ${deviceToken(deviceId)}`)
      .send(credentials);
    expect(res.status).toBe(200);
    expect(gateway.identity.auth.calls.at(-1)?.context).toMatchObject({ kind: 'device', deviceId });
  });

  it('answers 401 to a token issued before the cutoff', async () => {
    const userId = newId();
    gateway.redis.values.set(tokenCutoffKey(userId), String(Date.now() + 1_000));
    const res = await request(server())
      .post('/api/v1/auth/logout/all')
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', `wf_at=${accountToken({ userId })}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('answers 503 on an account route when Redis is down, and still serves a public one', async () => {
    gateway.redis.failure = new Error('down');
    const account = await request(server())
      .post('/api/v1/auth/logout/all')
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', `wf_at=${accountToken()}`);
    expect(account.status).toBe(503);
    expect(account.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
    const open = await request(server())
      .post('/api/v1/auth/login')
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', `wf_at=${accountToken()}`)
      .send(credentials);
    expect(open.status).toBe(200); // the rate limiter fails open, and PUBLIC ignores the check
  });

  it('ignores a console bearer', async () => {
    const res = await request(server())
      .post('/api/v1/auth/logout/all')
      .set('X-Wayfare-Client', 'console')
      .set('Authorization', `Bearer ${accountToken()}`);
    expect(res.status).toBe(401);
  });
});

describe('brute force', () => {
  it('trips the email bucket while the IP rotates', async () => {
    gateway.identity.auth.handlers.login = () =>
      Promise.reject(
        serviceError(status.UNAUTHENTICATED, { 'wf-error-code': 'INVALID_CREDENTIALS' }),
      );
    for (let n = 0; n < 10; n++) {
      const res = await request(server())
        .post('/api/v1/auth/login')
        .set('X-Wayfare-Client', 'console')
        .set('X-Forwarded-For', `203.0.113.${n}`)
        .send({ ...credentials, email: 'Target@Example.com' });
      expect(res.status).toBe(401);
    }
    const res = await request(server())
      .post('/api/v1/auth/login')
      .set('X-Wayfare-Client', 'console')
      .set('X-Forwarded-For', '203.0.113.200')
      .send({ ...credentials, email: 'target@example.com' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('900');
  });
});

describe('old builds', () => {
  let strict: E2eApp;

  beforeAll(async () => {
    strict = await bootGateway({ MIN_SUPPORTED_APP_VERSION: '1.0.0' });
    strict.identity.devices.handlers.registerDevice = () =>
      Promise.resolve({ deviceId: newId(), deviceSecret: 's', accessToken: 't', expiresIn: 900 });
    strict.identity.devices.handlers.updateDevice = () =>
      Promise.resolve({ device: { deviceId: newId(), appVersion: '1.0.0', contentLocale: 'en' } });
  });

  afterAll(() => strict.app.close());

  const device = { platform: 'IOS', contentLocale: 'en', privacyPolicyVersion: '2026-09-01' };

  it('refuses POST /devices by its body, and other mobile routes by the header', async () => {
    const old = await request(strict.app.getHttpServer())
      .post('/api/v1/devices')
      .set('X-Wayfare-Client', 'mobile')
      .send({ ...device, appVersion: '0.0.1' });
    expect(old.status).toBe(426);
    expect(old.body.error).toMatchObject({
      code: 'APP_VERSION_UNSUPPORTED',
      details: { minimumVersion: '1.0.0' },
    });
    const current = await request(strict.app.getHttpServer())
      .post('/api/v1/devices')
      .set('X-Wayfare-Client', 'mobile')
      .send({ ...device, appVersion: '1.0.0' });
    expect(current.status).toBe(201);

    const patch = (version?: string) => {
      const call = request(strict.app.getHttpServer())
        .patch('/api/v1/devices/me')
        .set('X-Wayfare-Client', 'mobile')
        .set('Authorization', `Bearer ${deviceToken()}`);
      return (version === undefined ? call : call.set('X-Wayfare-App-Version', version)).send({});
    };
    expect((await patch()).status).toBe(426);
    expect((await patch('0.9.9')).status).toBe(426);
    expect((await patch('1.0.0')).status).toBe(200);
  });

  it('never version-checks the console', async () => {
    strict.identity.auth.handlers.login = () => Promise.resolve({ session: stubSession() });
    const res = await request(strict.app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Wayfare-Client', 'console')
      .send(credentials);
    expect(res.status).toBe(200);
  });

  it('checks nothing with the default floor', async () => {
    gateway.identity.devices.handlers.updateDevice = () =>
      Promise.resolve({ device: { deviceId: newId(), appVersion: '0.0.1', contentLocale: 'en' } });
    const res = await request(server())
      .patch('/api/v1/devices/me')
      .set('X-Wayfare-Client', 'mobile')
      .set('Authorization', `Bearer ${deviceToken()}`)
      .send({});
    expect(res.status).toBe(200);
  });
});
