import { zRecovery } from '@wayfare/contracts';
import type { Recovery } from '@wayfare/contracts';
import { accountRecoveryStatusProto, recoveryEvidenceCodeProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { fromOptionalProtoTimestamp, fromProtoTimestamp } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { visibleName } from '../people-names/people-names.service';
import type { RecoveryQueryDto } from './dto/admin-recovery.dto';

/** The `ListRecoveries` request. Unspecified means every status. */
export function toListRecoveriesRequest(
  query: RecoveryQueryDto,
): identityGrpc.ListRecoveriesRequest {
  return {
    page: { page: query.page, pageSize: query.pageSize, sort: '' },
    status:
      query.status === undefined
        ? accountRecoveryStatusProto.toProto(null)
        : accountRecoveryStatusProto.toProto(query.status),
  };
}

/** One case; an absent optional becomes `null` (conventions §6.3). */
export function toRecovery(
  recovery: identityGrpc.Recovery | undefined,
  context: AccountContext,
): Recovery {
  if (recovery === undefined) throw new Error('identity sent no recovery');
  const status = accountRecoveryStatusProto.fromProto(recovery.status);
  if (status === null) throw new Error('identity sent an unknown recovery status');
  return zRecovery.parse({
    id: recovery.id,
    userId: recovery.userId,
    status: status,
    requestedEmail: recovery.requestedEmail,
    evidenceCodes: recovery.evidenceCodes.map((code) => {
      const parsed = recoveryEvidenceCodeProto.fromProto(code);
      if (parsed === null) throw new Error('identity sent an unknown evidence code');
      return parsed;
    }),
    supportReference: recovery.supportReference,
    openedById: recovery.openedById,
    approvedById: recovery.approvedById ?? null,
    decisionNote: recovery.decisionNote ?? null,
    holdUntil: fromOptionalProtoTimestamp(recovery.holdUntil, 'holdUntil')?.toISOString() ?? null,
    expiresAt: fromProtoTimestamp(recovery.expiresAt, 'expiresAt').toISOString(),
    completedAt:
      fromOptionalProtoTimestamp(recovery.completedAt, 'completedAt')?.toISOString() ?? null,
    createdAt: fromProtoTimestamp(recovery.createdAt, 'createdAt').toISOString(),
    updatedAt: fromProtoTimestamp(recovery.updatedAt, 'updatedAt').toISOString(),
    owner: { name: recovery.owner?.name ?? null, email: recovery.owner?.email ?? '' },
    openedBy: {
      id: recovery.openedById,
      name: visibleName(context, recovery.openedByName),
    },
    approvedBy:
      recovery.approvedById === undefined
        ? null
        : { id: recovery.approvedById, name: visibleName(context, recovery.approvedByName) },
    approvedAt:
      fromOptionalProtoTimestamp(recovery.approvedAt, 'approvedAt')?.toISOString() ?? null,
  });
}
