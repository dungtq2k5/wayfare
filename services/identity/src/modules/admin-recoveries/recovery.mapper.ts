import { RECOVERY_HOLD_HOURS } from '@wayfare/contracts';
import type { AccountRecoveryStatus, RecoveryEvidenceCode } from '@wayfare/contracts';
import { accountRecoveryStatusProto, recoveryEvidenceCodeProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';
import { nameOf } from '../users/domain/name-of';

const HOUR_MS = 3_600_000;
const PERSON = { select: { fullName: true, email: true, erasedAt: true } } as const;

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

/**
 * A case with its people, as staff read it. Read outside a write's transaction: relation reads in
 * one would run side by side on its single connection.
 */
export const RECOVERY_VIEW_SELECT = {
  ...RECOVERY_SELECT,
  user: PERSON,
  openedBy: PERSON,
  approvedBy: PERSON,
} as const;

/** A case with its people. */
export type RecoveryViewRow = Prisma.AccountRecoveryGetPayload<{
  select: typeof RECOVERY_VIEW_SELECT;
}>;

/** One case on the wire (api-endpoints-plan §1.10). */
export function toRecovery(row: RecoveryViewRow): identityGrpc.Recovery {
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
    owner: { ...nameOf(row.user), email: row.user.email },
    ...(nameOf(row.openedBy).name === undefined ? {} : { openedByName: nameOf(row.openedBy).name }),
    ...(row.approvedBy === null || nameOf(row.approvedBy).name === undefined
      ? {}
      : { approvedByName: nameOf(row.approvedBy).name }),
    // Approval starts the hold, so the hold's end less its length is when it was approved.
    approvedAt:
      row.holdUntil === null
        ? undefined
        : toProtoTimestamp(new Date(row.holdUntil.getTime() - RECOVERY_HOLD_HOURS * HOUR_MS)),
  };
}
