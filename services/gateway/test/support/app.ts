// The gateway, booted in-process for the e2e suites: identity stubbed per method, Redis faked with
// the scripts' semantics, and a throwaway signing key minting the tokens identity would.
import { Metadata } from '@grpc/grpc-js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { newId, TOKEN_TYPES } from '@wayfare/contracts';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { signJws, toProtoTimestamp, zPrivateKeyEnv } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import {
  FakeRedis,
  generateTestSigningKeys,
  snapshotProcessEnv,
} from '@wayfare/nest-common/testing';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../../src/app.module';
import type { GatewayConfig } from '../../src/config/env.schema';
import { configureApp } from '../../src/configure-app';
import { CatalogServiceGrpcClient } from '../../src/modules/catalog/catalog-service-grpc.client';
import { IdentityServiceGrpcClient } from '../../src/modules/identity/identity-service-grpc.client';
import { BillingServiceGrpcClient } from '../../src/modules/billing/billing-service-grpc.client';
import { NarrationServiceGrpcClient } from '../../src/modules/narration-client/narration-service-grpc.client';
import { SOCKET_REVALIDATE_INTERVAL } from '../../src/modules/events/events.gateway';
import { REDIS } from '../../src/modules/ops/redis.module';
import { RedisIoAdapter } from '../../src/redis-io.adapter';

const keys = generateTestSigningKeys('e2e-key');
const privateKey = zPrivateKeyEnv.parse(keys.privateKey);

/** The e2e environment; `overrides` change single variables. */
export function e2eEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    PORT: '3999', // never listened on: supertest drives the server directly
    GLOBAL_PREFIX: 'api',
    CORS_ORIGINS: 'http://localhost:5173',
    TRUST_PROXY_HOPS: '1',
    SWAGGER_ENABLED: 'true',
    IDENTITY_GRPC_URL: 'localhost:1',
    CATALOG_GRPC_URL: 'localhost:2',
    NARRATION_GRPC_URL: 'localhost:3',
    BILLING_GRPC_URL: 'localhost:4',
    PUBLIC_QR_BASE_URL: 'https://go.wayfare.test',
    PUBLIC_LINK_BASE_URL: 'https://wayfare.test',
    JWT_PUBLIC_KEYS: keys.publicKeys,
    REDIS_URL: 'redis://localhost:1',
    METRICS_PORT: '1',
    ...overrides,
  };
}

type Handler = (request: never, context: RequestContext) => Promise<unknown>;

/** One stubbed identity service: a handler per method, and every call recorded. */
export class StubCaller {
  readonly calls: { method: string; request: unknown; context: RequestContext }[] = [];
  handlers: Record<string, Handler> = {};

  call(method: string, request: unknown, context: RequestContext): Promise<unknown> {
    this.calls.push({ method, request, context });
    const handler = this.handlers[method];
    if (handler === undefined) return Promise.reject(new Error(`No stub for ${method}`));
    return handler(request as never, context);
  }

  init(): void {
    // nothing to open: the stub has no connection of its own
  }
}

/** identity, stubbed (conventions §17.1: gRPC peers are stubbed in the gateway e2e suite). */
export class IdentityStub {
  readonly devices = new StubCaller();
  readonly auth = new StubCaller();
  readonly users = new StubCaller();
  readonly adminUsers = new StubCaller();
  readonly roles = new StubCaller();
  readonly audit = new StubCaller();
  readonly passwords = new StubCaller();
  readonly emailChange = new StubCaller();
  readonly emailWebhooks = new StubCaller();
  readonly notifications = new StubCaller();
  readonly owner = new StubCaller();
  readonly ownerReview = new StubCaller();
  readonly adminRecoveries = new StubCaller();
  readonly recoveries = new StubCaller();

  onModuleInit(): void {}

  reset(): void {
    for (const caller of [
      this.devices,
      this.auth,
      this.users,
      this.adminUsers,
      this.roles,
      this.audit,
      this.passwords,
      this.emailChange,
      this.emailWebhooks,
      this.notifications,
      this.owner,
      this.ownerReview,
      this.adminRecoveries,
      this.recoveries,
    ]) {
      caller.calls.length = 0;
      caller.handlers = {};
    }
    // A fresh user: no cutoff.
    this.auth.handlers.getTokenCutoff = () => Promise.resolve({});
  }
}

/** catalog, stubbed the same way. */
export class CatalogStub {
  readonly placeQueries = new StubCaller();
  readonly placeAdmin = new StubCaller();
  readonly uploads = new StubCaller();
  readonly ownerPlaces = new StubCaller();
  readonly submissions = new StubCaller();
  readonly submissionReview = new StubCaller();
  readonly taxonomyAdmin = new StubCaller();
  readonly mapPackAdmin = new StubCaller();
  readonly offline = new StubCaller();
  readonly favorites = new StubCaller();

  onModuleInit(): void {}

  reset(): void {
    for (const caller of [
      this.placeQueries,
      this.placeAdmin,
      this.uploads,
      this.ownerPlaces,
      this.submissions,
      this.submissionReview,
      this.taxonomyAdmin,
      this.mapPackAdmin,
      this.offline,
      this.favorites,
    ]) {
      caller.calls.length = 0;
      caller.handlers = {};
    }
  }
}

/** narration, stubbed the same way. */
export class NarrationStub {
  readonly narration = new StubCaller();
  readonly synthesisAdmin = new StubCaller();
  readonly pronunciations = new StubCaller();
  readonly corrections = new StubCaller();
  readonly hotset = new StubCaller();
  readonly ttsStream = new StubCaller();
  readonly uiBundles = new StubCaller();

  onModuleInit(): void {}

  reset(): void {
    for (const caller of [
      this.narration,
      this.synthesisAdmin,
      this.pronunciations,
      this.corrections,
      this.hotset,
      this.ttsStream,
      this.uiBundles,
    ]) {
      caller.calls.length = 0;
      caller.handlers = {};
    }
  }
}

/** billing, stubbed the same way. */
export class BillingStub {
  readonly billing = new StubCaller();
  readonly plans = new StubCaller();
  readonly accounts = new StubCaller();
  readonly events = new StubCaller();
  readonly webhooks = new StubCaller();

  onModuleInit(): void {}

  reset(): void {
    for (const caller of [this.billing, this.plans, this.accounts, this.events, this.webhooks]) {
      caller.calls.length = 0;
      caller.handlers = {};
    }
  }
}

/** The fake Redis, with the readiness surface the ops module uses. */
export class E2eRedis extends FakeRedis {
  healthy = true;
  ping(): Promise<string> {
    return this.healthy ? Promise.resolve('PONG') : Promise.reject(new Error('down'));
  }
  quit(): Promise<string> {
    return Promise.resolve('OK');
  }
}

/** A booted gateway and its fakes. */
export interface E2eApp {
  readonly app: NestExpressApplication;
  readonly identity: IdentityStub;
  readonly catalog: CatalogStub;
  readonly narration: NarrationStub;
  readonly billing: BillingStub;
  readonly redis: E2eRedis;
  readonly config: GatewayConfig;
}

/** Boots the gateway exactly as `main.ts` configures it. */
export async function bootGateway(
  overrides: Record<string, string> = {},
  options: { sockets?: { revalidateMs: number } } = {},
): Promise<E2eApp> {
  // The config module writes validated values back into process.env: restored once the app is built.
  const restoreEnv = snapshotProcessEnv();
  const identity = new IdentityStub();
  identity.reset();
  const catalog = new CatalogStub();
  const narration = new NarrationStub();
  const billing = new BillingStub();
  const redis = new E2eRedis();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({ env: e2eEnv(overrides) })],
  })
    .overrideProvider(IdentityServiceGrpcClient)
    .useValue(identity)
    .overrideProvider(CatalogServiceGrpcClient)
    .useValue(catalog)
    .overrideProvider(NarrationServiceGrpcClient)
    .useValue(narration)
    .overrideProvider(BillingServiceGrpcClient)
    .useValue(billing)
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(SOCKET_REVALIDATE_INTERVAL)
    .useValue(options.sockets?.revalidateMs ?? 60_000)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    rawBody: true,
    logger: false,
  });
  const config = app.get<GatewayConfig>(ConfigService);
  configureApp(app, config);
  if (options.sockets === undefined) {
    await app.init();
  } else {
    // The socket needs a real listener; its adapter runs without Redis (a single replica).
    app.useWebSocketAdapter(new RedisIoAdapter(app, config.get('CORS_ORIGINS', { infer: true })));
    await app.listen(0, '127.0.0.1');
  }
  restoreEnv();
  return { app, identity, catalog, narration, billing, redis, config };
}

const now = () => new Date();

/** A device token, as identity would sign it. */
export function deviceToken(deviceId: string = newId()): string {
  return signJws(
    { typ: TOKEN_TYPES.device, sub: deviceId },
    { privateKey, keyId: keys.keyId, ttlMs: 900_000, now: now() },
  ).token;
}

/** An account token, as identity would sign it. */
export function accountToken(
  claims: Partial<{
    userId: string;
    sessionId: string;
    deviceId: string;
    perms: string[];
    ov: boolean;
    ev: boolean;
  }> = {},
  issuedAt: Date = now(),
): string {
  return signJws(
    {
      typ: TOKEN_TYPES.user,
      sub: claims.userId ?? newId(),
      iatMs: issuedAt.getTime(),
      sid: claims.sessionId ?? newId(),
      ...(claims.deviceId === undefined ? {} : { did: claims.deviceId }),
      perms: claims.perms ?? [],
      ov: claims.ov ?? false,
      ev: claims.ev ?? true,
    },
    { privateKey, keyId: keys.keyId, ttlMs: 1_800_000, now: issuedAt },
  ).token;
}

/** A session as identity returns it. */
export function stubSession(overrides: Partial<identityGrpc.Session> = {}): identityGrpc.Session {
  const at = now();
  return {
    user: {
      id: newId(),
      email: 'ann@example.com',
      fullName: 'Ann',
      preferredLocale: 'en',
      isEmailVerified: false,
      emailBounced: false,
      createdAt: toProtoTimestamp(at),
    },
    accessToken: 'access-token',
    accessExpiresAt: toProtoTimestamp(new Date(at.getTime() + 1_800_000)),
    refreshToken: 'refresh-token',
    refreshExpiresAt: toProtoTimestamp(new Date(at.getTime() + 604_800_000)),
    ...overrides,
  };
}

/** A gRPC failure as the client sees one. */
export function serviceError(code: number, entries: Record<string, string> = {}): Error {
  const metadata = new Metadata();
  for (const [key, value] of Object.entries(entries)) metadata.set(key, value);
  return Object.assign(new Error('grpc'), { code, details: 'x', metadata });
}
