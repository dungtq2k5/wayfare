import { Metadata, status } from '@grpc/grpc-js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { identityGrpc } from '@wayfare/contracts/grpc';
import type { RequestContext } from '@wayfare/nest-common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { loadConfig } from '../../src/config/env.schema';
import { configureApp } from '../../src/configure-app';
import { IdentityServiceGrpcClient } from '../../src/modules/devices/identity-service-grpc.client';
import { REDIS } from '../../src/modules/ops/redis.module';

const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  PORT: '3999', // never listened on: supertest drives the server directly
  GLOBAL_PREFIX: 'api',
  CORS_ORIGINS: 'http://localhost:5173',
  TRUST_PROXY_HOPS: '1',
  SWAGGER_ENABLED: 'true',
  IDENTITY_GRPC_URL: 'localhost:1',
  REDIS_URL: 'redis://localhost:1',
  METRICS_PORT: '1',
});

/** identity, stubbed (conventions §17.1: gRPC peers are stubbed in the gateway e2e suite). */
class IdentityStub {
  calls: { request: identityGrpc.RegisterDeviceRequest; context: RequestContext }[] = [];
  next: () => Promise<identityGrpc.RegisterDeviceResponse> = () =>
    Promise.resolve({ deviceId: '01a0aa49-c07f-715b-bbe1-35ea926e0980', deviceSecret: 's3cret' });

  registerDevice(requestBody: identityGrpc.RegisterDeviceRequest, context: RequestContext) {
    this.calls.push({ request: requestBody, context });
    return this.next();
  }
}

const redis = {
  healthy: true,
  ping: () => (redis.healthy ? Promise.resolve('PONG') : Promise.reject(new Error('down'))),
  quit: () => Promise.resolve('OK'),
};

function serviceError(code: status, entries: Record<string, string> = {}): Error {
  const metadata = new Metadata();
  for (const [key, value] of Object.entries(entries)) metadata.set(key, value);
  return Object.assign(new Error('grpc'), { code, details: 'x', metadata });
}

const body = {
  platform: 'ANDROID',
  appVersion: '0.1.0',
  contentLocale: 'en',
  privacyPolicyVersion: '2026-09-01',
};

let app: NestExpressApplication;
const identity = new IdentityStub();

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
    .overrideProvider(IdentityServiceGrpcClient)
    .useValue(identity)
    .overrideProvider(REDIS)
    .useValue(redis)
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: false });
  configureApp(app, config);
  await app.init();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  identity.calls = [];
  identity.next = () =>
    Promise.resolve({ deviceId: '01a0aa49-c07f-715b-bbe1-35ea926e0980', deviceSecret: 's3cret' });
  redis.healthy = true;
});

const post = () => request(app.getHttpServer()).post('/api/v1/devices');

describe('POST /api/v1/devices', () => {
  it('registers a device: 201, enveloped, never cached', async () => {
    const res = await post()
      .set('X-Wayfare-Client', 'mobile')
      .set('X-Forwarded-For', '198.51.100.7')
      .send(body);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      data: { deviceId: '01a0aa49-c07f-715b-bbe1-35ea926e0980', deviceSecret: 's3cret' },
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('maps the body to proto and passes the OBSERVED origin, not a claimed one', async () => {
    await post()
      .set('X-Wayfare-Client', 'mobile')
      .set('User-Agent', 'Wayfare/1.0')
      .set('X-Forwarded-For', '198.51.100.7')
      .send(body);
    expect(identity.calls[0]?.request).toEqual({
      platform: identityGrpc.Platform.PLATFORM_ANDROID,
      appVersion: '0.1.0',
      contentLocale: 'en',
      privacyPolicyVersion: '2026-09-01',
    });
    // TRUST_PROXY_HOPS=1: exactly one hop is trusted, so X-Forwarded-For's last entry is the client.
    expect(identity.calls[0]?.context).toEqual({
      kind: 'anonymous',
      origin: { ip: '198.51.100.7', userAgent: 'Wayfare/1.0' },
    });
  });

  it('refuses a request without X-Wayfare-Client before touching identity', async () => {
    const res = await post().send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CLIENT_HEADER_REQUIRED');
    expect(res.body.error.requestId).toEqual(expect.any(String));
    expect(identity.calls).toHaveLength(0);
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
    identity.next = () => Promise.reject(serviceError(status.UNAVAILABLE));
    const res = await post().set('X-Wayfare-Client', 'mobile').send(body);
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    expect(res.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('answers 504 UPSTREAM_TIMEOUT when identity is too slow', async () => {
    identity.next = () => Promise.reject(serviceError(status.DEADLINE_EXCEEDED));
    const res = await post().set('X-Wayfare-Client', 'mobile').send(body);
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('UPSTREAM_TIMEOUT');
  });

  it("passes identity's error code and details through", async () => {
    identity.next = () =>
      Promise.reject(
        serviceError(status.INVALID_ARGUMENT, {
          'wf-error-code': 'VALIDATION_FAILED',
          'wf-error-details': '{"issues":[{"path":"/platform","code":"invalid_value"}]}',
        }),
      );
    const res = await post().set('X-Wayfare-Client', 'mobile').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { issues: [{ path: '/platform' }] },
    });
  });

  it('never serves an unversioned or v2 path', async () => {
    expect(
      (
        await request(app.getHttpServer())
          .post('/api/devices')
          .set('X-Wayfare-Client', 'web')
          .send(body)
      ).status,
    ).toBe(404);
    const res = await request(app.getHttpServer())
      .post('/api/v2/devices')
      .set('X-Wayfare-Client', 'web')
      .send(body);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});

describe('ops routes', () => {
  it('serves /health and /health/ready unprefixed and version-neutral, without the client header', async () => {
    // Unwrapped on every service (api-endpoints-plan §13).
    expect((await request(app.getHttpServer()).get('/health')).body).toEqual({ status: 'ok' });
    const ready = await request(app.getHttpServer()).get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ ready: true, checks: { redis: { ok: true } } });
  });

  it('does NOT serve the ops routes under a version or the prefix', async () => {
    expect((await request(app.getHttpServer()).get('/v1/health/ready')).status).toBe(404);
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/v1/health/ready')
          .set('X-Wayfare-Client', 'web')
      ).status,
    ).toBe(404);
  });

  it('answers 503 on /health/ready when Redis is down', async () => {
    redis.healthy = false;
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.checks.redis).toEqual({ ok: false, error: 'down' });
  });

  it('serves /version', async () => {
    const res = await request(app.getHttpServer()).get('/version');
    expect(res.body).toMatchObject({ service: 'gateway', version: '0.0.0-dev' });
  });
});

describe('edge behaviour', () => {
  it('keeps the STRICT CSP on API routes and relaxes it for Swagger UI only', async () => {
    const api = await post().set('X-Wayfare-Client', 'web').send(body);
    expect(api.headers['content-security-policy']).toContain("script-src 'self';");
    const docs = await request(app.getHttpServer()).get('/docs/');
    expect(docs.status).toBe(200);
    expect(docs.headers['content-security-policy']).toContain("script-src 'self' 'unsafe-inline'");
  });

  it('publishes the OpenAPI document with the route and its error codes, and no probes', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json');
    const operation = res.body.paths['/api/v1/devices'].post;
    expect(Object.keys(operation.responses).sort()).toEqual(['201', '400', '503', '504']);
    expect(res.body.paths['/health']).toBeUndefined();
  });

  it('allows the client header in a CORS preflight from an allowed origin', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/devices')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'x-wayfare-client,content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-headers']).toContain('X-Wayfare-Client');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
