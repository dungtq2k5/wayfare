import { AUDIT_RECORD } from '@wayfare/contracts';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { hashToken } from '@wayfare/nest-common';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';
import { identityServices } from '../setup/services';

const prisma = testPrisma();
const { devices } = identityServices(prisma);
const context = { kind: 'anonymous', origin: { ip: '203.0.113.9', userAgent: 'it/1.0' } } as const;
const request = {
  platform: identityGrpc.Platform.PLATFORM_IOS,
  appVersion: '0.1.0',
  osVersion: '18.2',
  contentLocale: 'ja',
  privacyPolicyVersion: '2026-09-01',
};

beforeEach(() => truncateAll(prisma));
afterAll(() => prisma.$disconnect());

describe('registerDevice against the test database', () => {
  it('writes the device and its outbox event in ONE transaction', async () => {
    const { deviceId, deviceSecret } = await devices.registerDevice(request, context);

    const device = await prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    expect(device).toMatchObject({
      platform: 'IOS',
      osVersion: '18.2',
      contentLocale: 'ja',
      secretHash: hashToken(deviceSecret),
    });
    expect(device.updatedAt).toBeInstanceOf(Date);

    const [event] = await prisma.outboxEvent.findMany({ where: { subject: AUDIT_RECORD.subject } });
    expect(event).toMatchObject({
      subject: AUDIT_RECORD.subject,
      aggregateId: deviceId,
      publishedAt: null,
      attempts: 0,
    });
    expect((event!.payload as { eventId: string }).eventId).toBe(event!.id);
  });

  it('rolls the device back when the outbox write fails', async () => {
    const failing = identityServices(prisma, {
      add: () => Promise.reject(new Error('outbox refused')),
    });
    await expect(failing.devices.registerDevice(request, context)).rejects.toThrow(
      'outbox refused',
    );
    expect(await prisma.device.count()).toBe(0);
  });
});

describe('schema invariants', () => {
  it('refuses a SECOND device with the same secret hash', async () => {
    const data = {
      id: '01a0aa49-c07f-715b-bbe1-35ea926e0981',
      secretHash: 'a'.repeat(64),
      platform: 'WEB',
      appVersion: '1',
      contentLocale: 'en',
    };
    await prisma.device.create({ data });
    await expect(
      prisma.device.create({ data: { ...data, id: '01a0aa49-c07f-715b-bbe1-35ea926e0982' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('gives updated_at a DATABASE default, so raw inserts need not supply it', async () => {
    await prisma.$executeRaw`
      INSERT INTO devices (id, secret_hash, platform, app_version, content_locale)
      VALUES ('01a0aa49-c07f-715b-bbe1-35ea926e0983'::uuid, ${'b'.repeat(64)}, 'WEB', '1', 'en')`;
    const row = await prisma.device.findUniqueOrThrow({
      where: { id: '01a0aa49-c07f-715b-bbe1-35ea926e0983' },
    });
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  it('has the partial index the relay relies on', async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'outbox_events_unpublished_idx'`;
    expect(rows[0]?.indexdef).toMatch(/WHERE \(published_at IS NULL\)/);
  });
});
