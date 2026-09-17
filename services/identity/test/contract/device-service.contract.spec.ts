import { credentials, loadPackageDefinition, Metadata, status } from '@grpc/grpc-js';
import type { GrpcObject, ServiceClientConstructor, ServiceError } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import type { INestApplication } from '@nestjs/common';
import { Transport } from '@nestjs/microservices';
import type { MicroserviceOptions } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { GRPC_PACKAGES, isUuidV7 } from '@wayfare/contracts';
import { GRPC_LOADER_OPTIONS, packCallerContext, protoPaths } from '@wayfare/nest-common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { snapshotProcessEnv } from '@wayfare/nest-common/testing';
import { testConfig, testEnv, truncateAll } from '../setup/database';

/**
 * identity's gRPC server in-process, driven by a plain @grpc/grpc-js client loading the protos
 * the way any peer does — this catches a proto regenerated on one side only, and trailing
 * metadata lost inside Nest's exception handling.
 */
const env = testEnv({ GRPC_URL: '127.0.0.1:50161' });
const config = testConfig({ GRPC_URL: '127.0.0.1:50161' });
// The config module writes validated values back into process.env; restored when the suite ends.
const restoreEnv = snapshotProcessEnv();
let app: INestApplication;
let deviceClient: InstanceType<ServiceClientConstructor>;
let authClient: InstanceType<ServiceClientConstructor>;
let userClient: InstanceType<ServiceClientConstructor>;
let healthClient: InstanceType<ServiceClientConstructor>;
let adminUserClient: InstanceType<ServiceClientConstructor>;
let roleClient: InstanceType<ServiceClientConstructor>;
let auditClient: InstanceType<ServiceClientConstructor>;
let passwordClient: InstanceType<ServiceClientConstructor>;
let emailChangeClient: InstanceType<ServiceClientConstructor>;
let webhookClient: InstanceType<ServiceClientConstructor>;

function unary<T>(
  client: InstanceType<ServiceClientConstructor>,
  method: string,
  request: object,
  metadata = new Metadata(),
): Promise<T> {
  return new Promise((resolve, reject) => {
    const call = client[method] as (
      r: object,
      m: Metadata,
      cb: (e: ServiceError | null, v: T) => void,
    ) => void;
    call.call(client, request, metadata, (error, value) =>
      error ? reject(error) : resolve(value),
    );
  });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({ env })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: [GRPC_PACKAGES.identity, GRPC_PACKAGES.health],
      protoPath: protoPaths('identity', 'health'),
      url: config.get('GRPC_URL', { infer: true }),
      loader: GRPC_LOADER_OPTIONS,
    },
  });
  await app.startAllMicroservices();
  await app.init();

  const loaded = loadPackageDefinition(
    loadSync(protoPaths('identity', 'health'), GRPC_LOADER_OPTIONS),
  );
  const identity = (loaded.wayfare as GrpcObject).identity as GrpcObject;
  const health = ((loaded.grpc as GrpcObject).health as GrpcObject).v1 as GrpcObject;
  deviceClient = new (identity.DeviceService as ServiceClientConstructor)(
    config.get('GRPC_URL', { infer: true }),
    credentials.createInsecure(),
  );
  authClient = new (identity.AuthService as ServiceClientConstructor)(
    config.get('GRPC_URL', { infer: true }),
    credentials.createInsecure(),
  );
  userClient = new (identity.UserService as ServiceClientConstructor)(
    config.get('GRPC_URL', { infer: true }),
    credentials.createInsecure(),
  );
  const client = (name: string) =>
    new (identity[name] as ServiceClientConstructor)(
      config.get('GRPC_URL', { infer: true }),
      credentials.createInsecure(),
    );
  adminUserClient = client('AdminUserService');
  roleClient = client('RoleService');
  auditClient = client('AuditService');
  passwordClient = client('PasswordService');
  emailChangeClient = client('EmailChangeService');
  webhookClient = client('EmailWebhookService');
  healthClient = new (health.Health as ServiceClientConstructor)(
    config.get('GRPC_URL', { infer: true }),
    credentials.createInsecure(),
  );
});

afterAll(async () => {
  deviceClient.close();
  authClient.close();
  userClient.close();
  healthClient.close();
  adminUserClient.close();
  roleClient.close();
  auditClient.close();
  passwordClient.close();
  emailChangeClient.close();
  webhookClient.close();
  await app.close();
  restoreEnv();
});

beforeEach(() => truncateAll(app.get(PrismaService)));

const caller = () =>
  packCallerContext({
    kind: 'anonymous',
    origin: { ip: '203.0.113.9', userAgent: 'contract/1.0' },
  });

describe('wayfare.identity.DeviceService', () => {
  it('RegisterDevice returns a v7 id and a secret, and leaves os_version absent when unset', async () => {
    const response = await unary<{ deviceId: string; deviceSecret: string }>(
      deviceClient,
      'registerDevice',
      { platform: 2, appVersion: '0.1.0', contentLocale: 'en', privacyPolicyVersion: '2026-09-01' },
      caller(),
    );
    expect(isUuidV7(response.deviceId)).toBe(true);
    expect(response.deviceSecret).toHaveLength(43);
    const device = await app
      .get(PrismaService)
      .device.findUniqueOrThrow({ where: { id: response.deviceId } });
    expect(device.osVersion).toBeNull();
  });

  it("a failed call carries wf-error-code and details in the client's ServiceError metadata", async () => {
    const error = await unary(
      deviceClient,
      'registerDevice',
      { platform: 0, appVersion: '0.1.0', contentLocale: 'en', privacyPolicyVersion: '2026-09-01' },
      caller(),
    ).catch((e: unknown) => e as ServiceError);
    expect((error as ServiceError).code).toBe(status.INVALID_ARGUMENT);
    expect((error as ServiceError).metadata.get('wf-error-code')).toEqual(['VALIDATION_FAILED']);
    expect(JSON.parse(String((error as ServiceError).metadata.get('wf-error-details')[0]))).toEqual(
      {
        issues: [{ path: '/platform', code: 'invalid_value' }],
      },
    );
  });

  it('refuses a call that carries no caller context (UNKNOWN: a caller bug, never user input)', async () => {
    const error = await unary(deviceClient, 'registerDevice', {
      platform: 2,
      appVersion: '0.1.0',
      contentLocale: 'en',
      privacyPolicyVersion: '2026-09-01',
    }).catch((e: unknown) => e as ServiceError);
    expect((error as ServiceError).code).toBe(status.UNKNOWN);
  });
});

interface WireSession {
  session: {
    user: { id: string; email: string; createdAt: { seconds: string; nanos: number } };
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: { seconds: string };
  };
}

describe('wayfare.identity device, auth and user RPCs', () => {
  it('RegisterDevice also returns a device token and its lifetime', async () => {
    const response = await unary<{
      accessToken: string;
      expiresIn: number;
      deviceSecret: string;
      deviceId: string;
    }>(
      deviceClient,
      'registerDevice',
      { platform: 1, appVersion: '1.0.0', contentLocale: 'en', privacyPolicyVersion: '2026-09-01' },
      caller(),
    );
    expect(response.accessToken.split('.')).toHaveLength(3);
    expect(response.expiresIn).toBe(900);
    const exchanged = await unary<{ accessToken: string }>(
      deviceClient,
      'exchangeDeviceToken',
      { deviceId: response.deviceId, deviceSecret: response.deviceSecret },
      caller(),
    );
    expect(exchanged.accessToken.split('.')).toHaveLength(3);
  });

  it('Register and Login carry the secret fields, the SessionClient enum and int64 timestamps', async () => {
    const email = `contract-${Date.now()}@example.com`;
    const registered = await unary<WireSession>(
      authClient,
      'register',
      {
        email,
        password: 'correct horse battery',
        preferredLocale: 'en',
        termsVersion: '2026-09-01',
        client: 1,
      },
      caller(),
    );
    expect(registered.session.user.email).toBe(email);
    expect(typeof registered.session.accessExpiresAt.seconds).toBe('string'); // int64 as a string
    const loggedIn = await unary<WireSession>(
      authClient,
      'login',
      { email, password: 'correct horse battery', client: 3 },
      caller(),
    );
    expect(loggedIn.session.refreshToken).toHaveLength(43);
    const session = await app
      .get(PrismaService)
      .session.findFirstOrThrow({ where: { client: 'MOBILE' } });
    expect(session.userId).toBe(registered.session.user.id);

    const cutoff = await unary<{ tokensValidAfterMs?: string }>(
      authClient,
      'getTokenCutoff',
      { userId: registered.session.user.id },
      caller(),
    );
    expect(cutoff.tokensValidAfterMs).toBeUndefined();

    const me = await unary<{ roles: string[]; ownerVerified: boolean }>(
      userClient,
      'getMe',
      {},
      packCallerContext({
        kind: 'account',
        userId: registered.session.user.id,
        sessionId: registered.session.user.id,
        deviceId: null,
        permissions: [],
        ownerVerified: false,
        emailVerified: false,
        origin: { ip: null, userAgent: null },
      }),
    );
    expect(me).toEqual({
      user: expect.any(Object) as unknown,
      roles: ['USER'],
      permissions: [],
      ownerVerified: false,
    });
  });

  it('refuses an unspecified SessionClient', async () => {
    const error = await unary(
      authClient,
      'login',
      { email: 'a@b.co', password: 'x', client: 0 },
      caller(),
    ).catch((e: unknown) => e as ServiceError);
    expect((error as ServiceError).metadata.get('wf-error-details')[0]).toContain('/client');
  });
});

/** A caller context acting as the given account. */
function accountCaller(userId: string) {
  return packCallerContext({
    kind: 'account',
    userId,
    sessionId: userId,
    deviceId: null,
    permissions: [],
    ownerVerified: false,
    emailVerified: true,
    origin: { ip: null, userAgent: null },
  });
}

describe('wayfare.identity staff administration RPCs', () => {
  async function superAdmin(): Promise<string> {
    const prisma = app.get(PrismaService);
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' } });
    const user = await prisma.user.create({
      data: { email: `root-${Date.now()}@example.com`, roles: { create: { roleId: role.id } } },
    });
    return user.id;
  }

  it('an optional field arrives without a synthetic oneof key, so strict schemas accept it', async () => {
    const userId = await superAdmin();
    const response = await unary<{ user: { fullName: string } }>(
      userClient,
      'updateMe',
      { fullName: 'Root' },
      accountCaller(userId),
    );
    expect(response.user.fullName).toBe('Root');
  });

  it('AdminUserService: create, list with the oneof item, get, lock with an absent expiry', async () => {
    const userId = await superAdmin();
    const prisma = app.get(PrismaService);
    const admin = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    const created = await unary<{ user: { id: string; roles: { code: string }[] } }>(
      adminUserClient,
      'createStaffUser',
      { email: 'staff@example.com', fullName: 'Staff', roleIds: [admin.id] },
      accountCaller(userId),
    );
    expect(created.user.roles.map((role) => role.code)).toEqual(['ADMIN']);
    const listed = await unary<{
      users: { user?: { id: string }; erased?: unknown }[];
      page: { total: number };
    }>(
      adminUserClient,
      'listUsers',
      { page: { page: 1, pageSize: 20, sort: 'email', q: 'staff' }, includeDeleted: false },
      accountCaller(userId),
    );
    expect(listed.page.total).toBe(1);
    expect(listed.users[0]?.user?.id).toBe(created.user.id);
    await unary(
      adminUserClient,
      'lockUser',
      { userId: created.user.id, reason: 'check' },
      accountCaller(userId),
    );
    const detail = await unary<{ user: { user: { isLocked: boolean }; lockReason: string } }>(
      adminUserClient,
      'getUser',
      { userId: created.user.id },
      accountCaller(userId),
    );
    expect(detail.user).toMatchObject({ user: { isLocked: true }, lockReason: 'check' });
  });

  it('RoleService and AuditService answer over the wire, with details on a refusal', async () => {
    const userId = await superAdmin();
    const created = await unary<{ role: { code: string; id: string } }>(
      roleClient,
      'createRole',
      { name: 'Support desk', permissionCodes: ['user.read'] },
      accountCaller(userId),
    );
    expect(created.role.code).toBe('CUSTOM_SUPPORT_DESK');
    const { groups } = await unary<{ groups: { group: string }[] }>(
      roleClient,
      'listPermissions',
      {},
      accountCaller(userId),
    );
    expect(groups[0]?.group).toBe('OWNER');
    const error = await unary(
      roleClient,
      'createRole',
      { name: 'Other', permissionCodes: ['legacy.unknown'] },
      accountCaller(userId),
    ).catch((e: unknown) => e as ServiceError);
    expect((error as ServiceError).metadata.get('wf-error-code')).toEqual(['VALIDATION_FAILED']);

    const now = Date.now();
    const logs = await unary<{ entries: unknown[]; page: { nextCursor?: string } }>(
      auditClient,
      'listAuditLogs',
      {
        page: { limit: 10 },
        from: { seconds: String(Math.floor(now / 1000) - 3600), nanos: 0 },
        to: { seconds: String(Math.floor(now / 1000) + 60), nanos: 0 },
      },
      accountCaller(userId),
    );
    expect(logs.entries).toEqual([]);
    expect(logs.page.nextCursor).toBeUndefined();
    const { actions } = await unary<{ actions: string[] }>(
      auditClient,
      'listAuditActions',
      {},
      accountCaller(userId),
    );
    expect(actions).toContain('ROLE_CREATED');
  });
});

describe('wayfare.identity email and link RPCs', () => {
  const codeOf = (error: unknown) =>
    (error as ServiceError).metadata.get('wf-error-code')[0] as string;

  it('RequestPasswordReset answers empty for any address; a bad link token is TOKEN_EXPIRED', async () => {
    expect(
      await unary(
        passwordClient,
        'requestPasswordReset',
        { email: 'nobody@example.com' },
        caller(),
      ),
    ).toEqual({});
    const validate = await unary(
      passwordClient,
      'validateResetToken',
      { token: 'x' },
      caller(),
    ).catch((e: unknown) => e);
    expect(codeOf(validate)).toBe('TOKEN_EXPIRED');
    const verify = await unary(emailChangeClient, 'verifyEmail', { token: 'x' }, caller()).catch(
      (e: unknown) => e,
    );
    expect(codeOf(verify)).toBe('TOKEN_EXPIRED');
  });

  it('ReceiveResendEvent carries the raw body as bytes, and an unverifiable one is refused', async () => {
    const error = await unary(
      webhookClient,
      'receiveResendEvent',
      {
        rawBody: Buffer.from('{"type":"email.delivered"}'),
        svixId: 'msg_1',
        svixTimestamp: String(Math.floor(Date.now() / 1000)),
        svixSignature: 'v1,bm9wZQ==',
      },
      caller(),
    ).catch((e: unknown) => e);
    expect((error as ServiceError).code).toBe(status.UNAUTHENTICATED);
  });

  it('CheckEmailDelivery and ListEmailDeliveries answer over the wire', async () => {
    const prisma = app.get(PrismaService);
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    const admin = await prisma.user.create({
      data: { email: `admin-${Date.now()}@example.com`, roles: { create: { roleId: role.id } } },
    });
    expect(
      await unary(
        adminUserClient,
        'checkEmailDelivery',
        { userId: admin.id, email: 'claimed@example.com' },
        accountCaller(admin.id),
      ),
    ).toEqual({ matches: false });
    expect(
      await unary(
        adminUserClient,
        'listEmailDeliveries',
        { userId: admin.id, page: { limit: 10 } },
        accountCaller(admin.id),
      ),
    ).toEqual({ deliveries: [], page: {} });
  });
});

describe('grpc.health.v1.Health', () => {
  it('reports SERVING while the database and NATS are reachable', async () => {
    expect(await unary(healthClient, 'check', {})).toEqual({ status: 1 }); // ServingStatus.SERVING
  });
});
