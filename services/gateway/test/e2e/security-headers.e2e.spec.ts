// The gateway's protective headers and its CSRF defence (architecture §10): helmet's set on every
// response, Swagger UI's own policy under /docs, the CORS allowlist, `Retry-After` exposed to a
// client that reads headers, and a cookie-carrying write refused without `X-Wayfare-Client` — a
// custom header forces a preflight the allowlist refuses. Pinned here so a dependency bump or a
// "simplification" can't drop one silently.
import { newId } from '@wayfare/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountToken, bootGateway } from '../support/app';
import type { E2eApp } from '../support/app';

let gateway: E2eApp;
const server = () => gateway.app.getHttpServer();
/** The allowlisted origin in the e2e env (`CORS_ORIGINS`). */
const LISTED = 'http://localhost:5173';

beforeAll(async () => {
  gateway = await bootGateway();
  gateway.catalog.placeAdmin.handlers.getPlaceQr = () =>
    Promise.resolve({ svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', publicCode: 'K7M2Q9XA' });
});

afterAll(() => gateway.app.close());

describe('the gateway’s headers', () => {
  it('sends helmet’s set on a JSON route', async () => {
    const res = await request(server()).get('/api/v1/areas').set('X-Wayfare-Client', 'web');
    const policy = res.headers['content-security-policy'] as string;
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("frame-ancestors 'self'");
    // Scripts only from the gateway itself: no inline script, no eval.
    expect(policy.split(';')).toContain("script-src 'self'");
    expect(policy).toContain("script-src-attr 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('gives /docs Swagger UI’s own policy, and keeps the strict one everywhere else', async () => {
    const docs = await request(server()).get('/docs/');
    const api = await request(server()).get('/api/v1/areas').set('X-Wayfare-Client', 'web');
    expect(docs.headers['content-security-policy']).toEqual(expect.any(String));
    expect(docs.headers['content-security-policy']).not.toBe(
      api.headers['content-security-policy'],
    );
  });

  it('carries the strict policy and nosniff on an SVG sticker', async () => {
    const res = await request(server())
      .get(`/api/v1/admin/places/${newId()}/qr`)
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', `wf_at=${accountToken({ perms: ['place.read'] })}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/svg\+xml/);
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('CORS', () => {
  const preflight = (origin: string) =>
    request(server())
      .options('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-wayfare-client');

  it('answers an unlisted origin’s preflight without allowing it', async () => {
    const res = await preflight('https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows a listed origin, with credentials and the client header', async () => {
    const res = await preflight(LISTED);
    expect(res.headers['access-control-allow-origin']).toBe(LISTED);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-headers']).toMatch(/x-wayfare-client/i);
  });

  it('exposes Retry-After on a listed origin’s answer', async () => {
    const res = await request(server())
      .get('/api/v1/areas')
      .set('Origin', LISTED)
      .set('X-Wayfare-Client', 'web');
    expect(res.headers['access-control-expose-headers']).toMatch(/retry-after/i);
  });
});

describe('the CSRF defence', () => {
  it('refuses a cookie-carrying write without X-Wayfare-Client', async () => {
    const res = await request(server())
      .post('/api/v1/auth/logout')
      .set('Cookie', `wf_at=${accountToken()}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CLIENT_HEADER_REQUIRED');
  });
});
