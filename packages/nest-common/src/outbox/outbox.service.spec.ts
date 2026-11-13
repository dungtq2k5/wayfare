import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  isUuidV7,
  newId,
} from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import type { OutboxBatchTx, OutboxEventCreateData } from '../prisma/helpers';
import { OutboxService } from './outbox.service';

function fakeTx(): OutboxBatchTx & { rows: OutboxEventCreateData[]; statements: number } {
  const rows: OutboxEventCreateData[] = [];
  const tx = {
    rows,
    statements: 0,
    outboxEvent: {
      create: (args: { data: OutboxEventCreateData }) => {
        rows.push(args.data);
        tx.statements++;
        return Promise.resolve({ id: args.data.id });
      },
      createMany: (args: { data: OutboxEventCreateData[] }) => {
        rows.push(...args.data);
        tx.statements++;
        return Promise.resolve({ count: args.data.length });
      },
    },
  };
  return tx;
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

describe('OutboxService.addMany', () => {
  it('writes one statement per 100 events, in input order, each id its eventId', async () => {
    const tx = fakeTx();
    const inputs = Array.from({ length: 250 }, () => input);
    const payloads = await new OutboxService().addMany(tx, AUDIT_RECORD, inputs);
    expect(tx.statements).toBe(3);
    expect(tx.rows).toHaveLength(250);
    expect(payloads.map((payload) => payload.eventId)).toEqual(tx.rows.map((row) => row.id));
  });

  it('validates every payload before the first insert', async () => {
    const tx = fakeTx();
    const bad = { ...input, metadata: { after: { secretHash: 'x' } } };
    await expect(new OutboxService().addMany(tx, AUDIT_RECORD, [input, bad])).rejects.toThrow();
    expect(tx.rows).toHaveLength(0);
  });
});
