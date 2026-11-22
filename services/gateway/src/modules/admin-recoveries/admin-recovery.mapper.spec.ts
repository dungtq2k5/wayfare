import { AccountRecoveryStatus, RecoveryEvidenceCode } from '@wayfare/contracts';
import { accountRecoveryStatusProto, recoveryEvidenceCodeProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import type { AccountContext } from '@wayfare/nest-common';
import { toProtoTimestamp } from '@wayfare/nest-common';
import { describe, expect, it } from 'vitest';
import { toRecovery } from './admin-recovery.mapper';

const id = (n: number) => `0190f0a0-0000-7000-8000-00000000000${n}`;
const ts = toProtoTimestamp(new Date('2026-05-01T00:00:00.000Z'));
const reader = (permissions: string[]) => ({ permissions }) as unknown as AccountContext;
const recovery = (over: Partial<identityGrpc.Recovery> = {}) =>
  ({
    id: id(1),
    userId: id(2),
    status: accountRecoveryStatusProto.toProto(AccountRecoveryStatus.PENDING_APPROVAL),
    requestedEmail: 'new@wayfare.test',
    evidenceCodes: [recoveryEvidenceCodeProto.toProto(RecoveryEvidenceCode.PHONE_CALLBACK)],
    supportReference: 'SR-1',
    openedById: id(3),
    openedByName: 'Staff',
    expiresAt: ts,
    createdAt: ts,
    updatedAt: ts,
    ...over,
  }) as identityGrpc.Recovery;

describe('a recovery case', () => {
  it('unapproved: no approver; an erased owner with no name and no email', () => {
    expect(toRecovery(recovery(), reader([]))).toMatchObject({
      approvedById: null,
      approvedBy: null,
      owner: { name: null, email: '' },
      openedBy: { id: id(3), name: null },
      evidenceCodes: [RecoveryEvidenceCode.PHONE_CALLBACK],
    });
  });

  it('approved: the approver, named only to a reader holding user.read', () => {
    const approved = recovery({
      approvedById: id(4),
      approvedByName: 'Lead',
      approvedAt: ts,
      owner: { name: 'An', email: 'an@wayfare.test' },
    });
    expect(toRecovery(approved, reader(['user.read']))).toMatchObject({
      approvedBy: { id: id(4), name: 'Lead' },
      owner: { name: 'An', email: 'an@wayfare.test' },
    });
    expect(toRecovery(approved, reader([])).approvedBy).toEqual({ id: id(4), name: null });
  });

  it('refuses no case, and a status or evidence code this build doesn’t know', () => {
    expect(() => toRecovery(undefined, reader([]))).toThrow('identity sent no recovery');
    expect(() => toRecovery(recovery({ status: 99 as never }), reader([]))).toThrow(
      'unknown recovery status',
    );
    expect(() => toRecovery(recovery({ evidenceCodes: [99 as never] }), reader([]))).toThrow(
      'unknown evidence code',
    );
  });
});
