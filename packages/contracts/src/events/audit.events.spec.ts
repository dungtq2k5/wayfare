import { describe, expect, it } from 'vitest';
import { AuditAction, AuditActorType, AuditResourceType } from '../audit';
import { newId } from '../ids';
import { AUDIT_RECORD, auditAggregateId, auditRecordPayloadSchema } from './audit.events';

const deviceId = newId();
const base = {
  eventId: newId(),
  occurredAt: '2026-09-16T12:00:00.000Z',
  service: 'identity',
  actor: { type: AuditActorType.DEVICE, deviceId },
  action: AuditAction.DEVICE_REGISTERED,
  resource: { type: AuditResourceType.DEVICE, id: deviceId },
};

describe('audit.record payload', () => {
  it('accepts allowlisted metadata', () => {
    const result = auditRecordPayloadSchema.safeParse({
      ...base,
      metadata: { after: { platform: 'ANDROID', appVersion: '0.1.0' } },
    });
    expect(result.success).toBe(true);
  });

  it('refuses a metadata field that is NOT allowlisted for the action', () => {
    const result = auditRecordPayloadSchema.safeParse({
      ...base,
      metadata: { after: { platform: 'ANDROID', secretHash: 'abc' } },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['metadata', 'after', 'secretHash']);
  });

  it('refuses a reason for an action that allows none', () => {
    expect(auditRecordPayloadSchema.safeParse({ ...base, metadata: { reason: 'x' } }).success).toBe(
      false,
    );
  });

  it('refuses an unknown top-level field', () => {
    expect(auditRecordPayloadSchema.safeParse({ ...base, email: 'a@b.c' }).success).toBe(false);
  });

  it('defaults metadata to an empty object', () => {
    expect(auditRecordPayloadSchema.parse(base).metadata).toEqual({});
  });
});

describe('auditAggregateId', () => {
  it('prefers the resource, then the actor', () => {
    expect(auditAggregateId(base)).toBe(deviceId);
    const userId = newId();
    expect(auditAggregateId({ actor: { userId }, resource: {} })).toBe(userId);
  });

  it('refuses an event with neither', () => {
    expect(() => auditAggregateId({ actor: {}, resource: {} })).toThrow();
  });

  it('is the definition used by AUDIT_RECORD', () => {
    expect(AUDIT_RECORD.aggregateId(auditRecordPayloadSchema.parse(base))).toBe(deviceId);
  });
});
