import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  isUuidV7,
  newId,
} from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import type { OutboxEventCreateData, OutboxTx } from '../prisma/helpers';
import { OutboxService } from './outbox.service';

function fakeTx(): OutboxTx & { rows: OutboxEventCreateData[] } {
  const rows: OutboxEventCreateData[] = [];
  return {
    rows,
    outboxEvent: {
      create: (args) => {
        rows.push(args.data);
        return Promise.resolve({ id: args.data.id });
      },
    },
  };
}

const deviceId = newId();
const input = {
  occurredAt: new Date().toISOString(),
  service: 'identity',
  actor: { type: AuditActorType.DEVICE, deviceId },
  action: AuditAction.DEVICE_REGISTERED,
  resource: { type: AuditResourceType.DEVICE, id: deviceId },
  metadata: { after: { platform: 'IOS' } },
};

describe('OutboxService.add', () => {
  it('generates the row id and injects the SAME id as eventId', async () => {
    const tx = fakeTx();
    const payload = await new OutboxService().add(tx, AUDIT_RECORD, input);
    const row = tx.rows[0]!;
    expect(isUuidV7(row.id)).toBe(true);
    expect(payload.eventId).toBe(row.id);
    expect((row.payload as { eventId: string }).eventId).toBe(row.id);
    expect(row.subject).toBe('audit.record');
    expect(row.aggregateId).toBe(deviceId);
  });

  it('refuses a payload that fails its schema BEFORE inserting — the business write fails', async () => {
    const tx = fakeTx();
    const bad = { ...input, metadata: { after: { secretHash: 'x' } } };
    await expect(new OutboxService().add(tx, AUDIT_RECORD, bad)).rejects.toThrow();
    expect(tx.rows).toHaveLength(0);
  });

  it('ignores an eventId a caller tries to smuggle in', async () => {
    const tx = fakeTx();
    const smuggled = { ...input, eventId: newId() } as typeof input;
    const payload = await new OutboxService().add(tx, AUDIT_RECORD, smuggled);
    expect(payload.eventId).toBe(tx.rows[0]!.id);
  });

  it('stores no traceparent when nothing is being traced', async () => {
    const tx = fakeTx();
    await new OutboxService().add(tx, AUDIT_RECORD, input);
    expect(tx.rows[0]!.traceParent).toBeNull();
  });
});
