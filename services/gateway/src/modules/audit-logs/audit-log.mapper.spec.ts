import { AuditActorType, AuditResourceType } from '@wayfare/contracts';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import type { AccountContext } from '@wayfare/nest-common';
import { toProtoTimestamp } from '@wayfare/nest-common';
import { describe, expect, it } from 'vitest';
import { toAuditLogResponseDto, toListAuditLogsRequest } from './audit-log.mapper';

const reader = (permissions: string[]) => ({ permissions }) as unknown as AccountContext;
const row = (over: Partial<identityGrpc.AuditLogEntry> = {}) =>
  ({
    id: 'l1',
    occurredAt: toProtoTimestamp(new Date('2026-05-01T00:00:00.000Z')),
    service: 'identity',
    action: 'user.ban',
    metadataJson: '{"reason":"spam"}',
    ...over,
  }) as identityGrpc.AuditLogEntry;

describe('an audit row', () => {
  it('refuses a row without an actor type; reads absent ids, names and kind as null', () => {
    expect(() => toAuditLogResponseDto(row(), reader([]))).toThrow();
    const dto = toAuditLogResponseDto(
      row({ actor: { type: 'SYSTEM' }, resource: { type: 'USER' } }),
      reader([]),
    );
    expect(dto).toMatchObject({
      actor: { type: AuditActorType.SYSTEM, userId: null, deviceId: null, name: null, kind: null },
      resource: { type: AuditResourceType.USER, id: null, label: null },
      metadata: { reason: 'spam' },
      ip: null,
      userAgent: null,
    });
  });

  it('names the actor and the resource only to a reader holding user.read', () => {
    const named = row({
      actor: { type: 'USER', userId: 'u1', name: 'An' },
      resource: { type: 'USER', id: 'u2', label: 'Bình' },
    });
    expect(toAuditLogResponseDto(named, reader(['user.read']))).toMatchObject({
      actor: { userId: 'u1', name: 'An' },
      resource: { id: 'u2', label: 'Bình' },
    });
    expect(toAuditLogResponseDto(named, reader([]))).toMatchObject({
      actor: { name: null },
      resource: { label: null },
    });
  });

  it('refuses metadata that isn’t an object: a server fault', () => {
    for (const metadataJson of ['[]', 'null', '"x"']) {
      expect(() =>
        toAuditLogResponseDto(
          row({ metadataJson, actor: { type: 'SYSTEM' }, resource: { type: 'USER' } }),
          reader([]),
        ),
      ).toThrow('non-object metadata');
    }
  });
});

describe('the ListAuditLogs request', () => {
  const window = { from: '2026-05-01T00:00:00.000Z', to: '2026-05-02T00:00:00.000Z', limit: 50 };

  it('sends only the filters given', () => {
    expect(toListAuditLogsRequest(window as never)).toEqual({
      page: { limit: 50 },
      from: toProtoTimestamp(new Date(window.from)),
      to: toProtoTimestamp(new Date(window.to)),
    });
    expect(
      toListAuditLogsRequest({
        ...window,
        cursor: 'c1',
        actorUserId: 'u1',
        action: 'user.ban',
        resourceType: 'USER',
        resourceId: 'u2',
      } as never),
    ).toMatchObject({
      page: { limit: 50, cursor: 'c1' },
      actorUserId: 'u1',
      action: 'user.ban',
      resourceType: 'USER',
      resourceId: 'u2',
    });
  });
});
