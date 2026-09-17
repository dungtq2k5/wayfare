import { describe, expect, it } from 'vitest';
import { AuditAction, AuditActorType, AuditResourceType } from '../audit/vocabulary';
import { newId } from '../common/ids';
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

  it('refuses a resource type that does not match the action', () => {
    const result = auditRecordPayloadSchema.safeParse({
      ...base,
      resource: { type: AuditResourceType.USER, id: deviceId },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['resource', 'type']);
  });

  it('refuses an anonymous actor that carries an id', () => {
    const failedLogin = {
      ...base,
      actor: { type: AuditActorType.ANONYMOUS },
      action: AuditAction.USER_LOGIN_FAILED,
      resource: { type: AuditResourceType.USER },
    };
    expect(auditRecordPayloadSchema.safeParse(failedLogin).success).toBe(true);
    expect(
      auditRecordPayloadSchema.safeParse({
        ...failedLogin,
        actor: { type: AuditActorType.ANONYMOUS, userId: newId() },
      }).success,
    ).toBe(false);
  });
});

describe('auditAggregateId', () => {
  it('prefers the resource, then the actor', () => {
    expect(auditAggregateId(base)).toBe(deviceId);
    const userId = newId();
    expect(auditAggregateId({ eventId: base.eventId, actor: { userId }, resource: {} })).toBe(
      userId,
    );
    expect(auditAggregateId({ eventId: base.eventId, actor: { deviceId }, resource: {} })).toBe(
      deviceId,
    );
  });

  it('falls back to the event id', () => {
    expect(auditAggregateId({ eventId: base.eventId, actor: {}, resource: {} })).toBe(base.eventId);
  });

  it('is the definition used by AUDIT_RECORD', () => {
    expect(AUDIT_RECORD.aggregateId(auditRecordPayloadSchema.parse(base))).toBe(deviceId);
  });
});
