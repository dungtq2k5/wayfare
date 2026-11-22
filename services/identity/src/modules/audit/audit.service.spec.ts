import { AuditAction, AuditActorType, AuditResourceType, newId } from '@wayfare/contracts';
import type { AuditRecordPayload } from '@wayfare/contracts';
import type { PrismaService } from '../prisma/prisma.service';
import { describe, expect, it, vi } from 'vitest';
import { AuditService } from './audit.service';

function service(create: (args: unknown) => Promise<unknown>) {
  const prisma = { auditLog: { create: vi.fn(create) } };
  return { audit: new AuditService(prisma as unknown as PrismaService), prisma };
}

const system: AuditRecordPayload = {
  eventId: newId(),
  occurredAt: '2026-11-21T08:00:00.000Z',
  service: 'identity',
  actor: { type: AuditActorType.SYSTEM },
  action: AuditAction.ACCOUNT_RECOVERY_EXPIRED,
  resource: { type: AuditResourceType.ACCOUNT_RECOVERY },
  metadata: {},
};

describe('recording an audit row', () => {
  it('stores an absent actor, device, resource id, address and agent as null', async () => {
    const { audit, prisma } = service(() => Promise.resolve({ id: 1 }));
    expect(await audit.record(system)).toBe(true);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: null,
          actorDeviceId: null,
          resourceId: null,
          ip: null,
          userAgent: null,
        }) as unknown,
      }),
    );
  });

  it('keeps every field a record names', async () => {
    const { audit, prisma } = service(() => Promise.resolve({ id: 1 }));
    const userId = newId();
    await audit.record({
      ...system,
      actor: { type: AuditActorType.USER, userId, deviceId: 'd1' },
      resource: { type: AuditResourceType.USER, id: userId },
      ip: '203.0.113.9',
      userAgent: 'Wayfare/1.0',
    });
    expect(prisma.auditLog.create.mock.calls[0]![0]).toMatchObject({
      data: { actorUserId: userId, actorDeviceId: 'd1', resourceId: userId, ip: '203.0.113.9' },
    });
  });

  it('treats a redelivery as already applied, and throws anything else for a retry', async () => {
    const duplicate = Object.assign(new Error('unique'), { code: 'P2002' });
    expect(await service(() => Promise.reject(duplicate)).audit.record(system)).toBe(false);
    const down = new Error('connection lost');
    await expect(service(() => Promise.reject(down)).audit.record(system)).rejects.toBe(down);
  });
});
