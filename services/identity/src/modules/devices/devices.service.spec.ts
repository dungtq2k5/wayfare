import { status } from '@grpc/grpc-js';
import { AUDIT_RECORD, isUuidV7 } from '@wayfare/contracts';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { hashToken } from '@wayfare/nest-common';
import { buildConfigService, generateTestSigningKeys } from '@wayfare/nest-common/testing';
import type { RequestContext, RpcErrorObject } from '@wayfare/nest-common';
import { RpcException } from '@nestjs/microservices';
import { describe, expect, it, vi } from 'vitest';
import { envSchema } from '../../config/env.schema';
import { LegalService } from '../legal/legal.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SessionsService } from '../sessions/sessions.service';
import { TokensService } from '../tokens/tokens.service';
import { DevicesService } from './devices.service';

const context: RequestContext = {
  kind: 'anonymous',
  origin: { ip: '203.0.113.9', userAgent: 'probe/1.0' },
};
const request: identityGrpc.RegisterDeviceRequest = {
  platform: identityGrpc.Platform.PLATFORM_ANDROID,
  appVersion: '0.1.0',
  contentLocale: 'en',
  privacyPolicyVersion: '2026-09-01',
};

const keys = generateTestSigningKeys();
const tokens = new TokensService(
  buildConfigService('identity', envSchema, {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://unit@localhost/unit',
    NATS_URL: 'nats://localhost:1',
    REDIS_URL: 'redis://localhost:1',
    JWT_PRIVATE_KEY: keys.privateKey,
    JWT_KEY_ID: keys.keyId,
    GRPC_URL: 'localhost:1',
    OPS_PORT: '1',
    METRICS_PORT: '2',
    EMAIL_PROVIDER: 'smtp',
    SMTP_URL: 'smtp://localhost:1',
    EMAIL_FROM: 'Wayfare <no-reply@wayfare.local>',
    EMAIL_DELIVERY_MODE: 'open',
    EMAIL_HASH_KEY: Buffer.alloc(32).toString('base64'),
    PII_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    CONSOLE_URL: 'http://console.localhost',
    WEB_URL: 'http://web.localhost',
  }),
);

function setup() {
  const tx = {
    device: { create: vi.fn().mockResolvedValue({ id: 'x' }) },
    legalAcceptance: { create: vi.fn().mockResolvedValue({ acceptedAt: new Date() }) },
  };
  const prisma = { $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  const outbox = { add: vi.fn().mockResolvedValue({}), addMany: vi.fn().mockResolvedValue([]) };
  const service = new DevicesService(
    prisma as unknown as PrismaService,
    outbox,
    tokens,
    new LegalService(),
    {} as SessionsService, // registration revokes nothing
  );
  return { service, tx, prisma, outbox };
}

function codeOf(error: unknown): unknown {
  return error instanceof RpcException
    ? (error.getError() as RpcErrorObject).metadata.get('wf-error-code')[0]
    : error;
}

describe('DevicesService.registerDevice', () => {
  it('stores only the SHA-256 of the secret and returns the plaintext once', async () => {
    const { service, tx } = setup();
    const response = await service.registerDevice(request, context);
    const data = tx.device.create.mock.calls[0]![0].data;
    expect(isUuidV7(response.deviceId)).toBe(true);
    expect(data.id).toBe(response.deviceId);
    expect(data.secretHash).toBe(hashToken(response.deviceSecret));
    expect(JSON.stringify(data)).not.toContain(response.deviceSecret);
    expect(data).toMatchObject({ platform: 'ANDROID', osVersion: null, contentLocale: 'en' });
    expect(response.accessToken.split('.')).toHaveLength(3);
    expect(response.expiresIn).toBe(900);
  });

  it('records the privacy policy acceptance for the device, with the observed ip', async () => {
    const { service, tx } = setup();
    const response = await service.registerDevice(request, context);
    expect(tx.legalAcceptance.create.mock.calls[0]![0].data).toEqual({
      userId: null,
      deviceId: response.deviceId,
      document: 'PRIVACY_POLICY',
      version: '2026-09-01',
      ip: '203.0.113.9',
    });
  });

  it('refuses an outdated privacy policy version before writing anything', async () => {
    const { service, prisma } = setup();
    const error = await service
      .registerDevice({ ...request, privacyPolicyVersion: '2025-01-01' }, context)
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe('LEGAL_VERSION_OUTDATED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('writes DEVICE_REGISTERED to the outbox INSIDE the same transaction', async () => {
    const { service, tx, outbox } = setup();
    const response = await service.registerDevice(request, context);
    const [usedTx, event, payload] = outbox.add.mock.calls[0]!;
    expect(usedTx).toBe(tx);
    expect(event).toBe(AUDIT_RECORD);
    expect(payload).toMatchObject({
      action: 'DEVICE_REGISTERED',
      actor: { type: 'DEVICE', deviceId: response.deviceId },
      resource: { type: 'DEVICE', id: response.deviceId },
      // The domain value, never the proto number.
      metadata: { after: { platform: 'ANDROID', appVersion: '0.1.0' } },
      ip: '203.0.113.9',
      userAgent: 'probe/1.0',
    });
    expect(payload).not.toHaveProperty('eventId');
  });

  it.each([identityGrpc.Platform.PLATFORM_UNSPECIFIED, identityGrpc.Platform.UNRECOGNIZED])(
    'refuses platform %s as INVALID_ARGUMENT, never defaulting it',
    async (platform) => {
      const { service, prisma } = setup();
      const error = await service
        .registerDevice({ ...request, platform }, context)
        .catch((e: unknown) => e);
      expect((error as RpcException).getError()).toMatchObject({ code: status.INVALID_ARGUMENT });
      expect(codeOf(error)).toBe('VALIDATION_FAILED');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('refuses an empty appVersion that bypassed the gateway', async () => {
    const { service } = setup();
    const error = await service
      .registerDevice({ ...request, appVersion: '' }, context)
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe('VALIDATION_FAILED');
  });

  it('omits origin fields the gateway did not observe', async () => {
    const { service, outbox } = setup();
    await service.registerDevice(request, {
      kind: 'anonymous',
      origin: { ip: null, userAgent: null },
    });
    expect(outbox.add.mock.calls[0]![2]).not.toHaveProperty('ip');
    expect(outbox.add.mock.calls[0]![2]).not.toHaveProperty('userAgent');
  });
});
