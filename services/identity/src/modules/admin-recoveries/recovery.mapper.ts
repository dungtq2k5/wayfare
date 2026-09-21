import type { AccountRecoveryStatus, RecoveryEvidenceCode } from '@wayfare/contracts';
import { accountRecoveryStatusProto, recoveryEvidenceCodeProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';

/** Every column a case's staff view needs. */
export const RECOVERY_SELECT = {
  id: true,
  userId: true,
  status: true,
  requestedEmail: true,
  evidenceCodes: true,
  supportReference: true,
  openedById: true,
  approvedById: true,
  decisionNote: true,
  holdUntil: true,
  expiresAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** A case's row. */
export type RecoveryRow = Prisma.AccountRecoveryGetPayload<{ select: typeof RECOVERY_SELECT }>;

/** One case on the wire (api-endpoints-plan §1.10). */
export function toRecovery(row: RecoveryRow): identityGrpc.Recovery {
  return {
    id: row.id,
    userId: row.userId,
    status: accountRecoveryStatusProto.toProto(row.status as AccountRecoveryStatus),
    requestedEmail: row.requestedEmail,
    evidenceCodes: row.evidenceCodes.map((code) =>
      recoveryEvidenceCodeProto.toProto(code as RecoveryEvidenceCode),
    ),
    supportReference: row.supportReference,
    openedById: row.openedById,
    ...(row.approvedById === null ? {} : { approvedById: row.approvedById }),
    ...(row.decisionNote === null ? {} : { decisionNote: row.decisionNote }),
    holdUntil: row.holdUntil === null ? undefined : toProtoTimestamp(row.holdUntil),
    expiresAt: toProtoTimestamp(row.expiresAt),
    completedAt: row.completedAt === null ? undefined : toProtoTimestamp(row.completedAt),
    createdAt: toProtoTimestamp(row.createdAt),
    updatedAt: toProtoTimestamp(row.updatedAt),
  };
}
