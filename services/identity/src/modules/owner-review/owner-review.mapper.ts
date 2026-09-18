import { OwnerRegistrationStatus, parseEnum } from '@wayfare/contracts';
import { ownerRegistrationStatusProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';
import {
  OWNER_REGISTRATION_SELECT,
  toOwnerRegistration,
} from '../owner-registrations/owner-registration.mapper';
import { isLockActive } from '../users/domain/account-state';

/** An application as the review queue reads it: the applicant's view plus the staff fields. */
export const OWNER_REGISTRATION_ADMIN_SELECT = {
  ...OWNER_REGISTRATION_SELECT,
  userId: true,
  internalNote: true,
  reviewedById: true,
  piiRedactedAt: true,
  user: {
    select: {
      id: true,
      email: true,
      fullName: true,
      createdAt: true,
      isEmailVerified: true,
      ownerVerifiedAt: true,
      isLocked: true,
      lockedUntil: true,
      deletedAt: true,
    },
  },
} as const satisfies Prisma.OwnerRegistrationSelect;

/** An application as `OWNER_REGISTRATION_ADMIN_SELECT` loads it. */
export type OwnerRegistrationAdminRow = Prisma.OwnerRegistrationGetPayload<{
  select: typeof OWNER_REGISTRATION_ADMIN_SELECT;
}>;

/** An earlier application: status and dates only. */
export const PRIOR_REGISTRATION_SELECT = {
  id: true,
  status: true,
  submittedAt: true,
  reviewedAt: true,
} as const satisfies Prisma.OwnerRegistrationSelect;

/** An earlier application as `PRIOR_REGISTRATION_SELECT` loads it. */
export type PriorRegistrationRow = Prisma.OwnerRegistrationGetPayload<{
  select: typeof PRIOR_REGISTRATION_SELECT;
}>;

/** A queue row. */
export function toOwnerRegistrationAdminItem(
  row: OwnerRegistrationAdminRow,
): identityGrpc.OwnerRegistrationAdminItem {
  return {
    registration: toOwnerRegistration(row),
    ...(row.internalNote === null ? {} : { internalNote: row.internalNote }),
    ...(row.reviewedById === null ? {} : { reviewedById: row.reviewedById }),
    piiRedacted: row.piiRedactedAt !== null,
    applicant: {
      id: row.user.id,
      email: row.user.email,
      ...(row.user.fullName === null ? {} : { fullName: row.user.fullName }),
    },
  };
}

/** Another application by the same person. */
export function toPriorRegistration(row: PriorRegistrationRow): identityGrpc.PriorRegistration {
  return {
    id: row.id,
    status: ownerRegistrationStatusProto.toProto(parseEnum(OwnerRegistrationStatus, row.status)),
    submittedAt: toProtoTimestamp(row.submittedAt),
    reviewedAt: row.reviewedAt === null ? undefined : toProtoTimestamp(row.reviewedAt),
  };
}

/** The review detail: the applicant's account as it stands `now`, and their other applications. */
export function toOwnerRegistrationAdmin(
  row: OwnerRegistrationAdminRow,
  prior: readonly PriorRegistrationRow[],
  now: Date,
): identityGrpc.OwnerRegistrationAdmin {
  const { user } = row;
  return {
    registration: toOwnerRegistration(row),
    ...(row.internalNote === null ? {} : { internalNote: row.internalNote }),
    ...(row.reviewedById === null ? {} : { reviewedById: row.reviewedById }),
    piiRedacted: row.piiRedactedAt !== null,
    applicant: {
      id: user.id,
      email: user.email,
      ...(user.fullName === null ? {} : { fullName: user.fullName }),
      createdAt: toProtoTimestamp(user.createdAt),
      emailVerified: user.isEmailVerified,
      ownerVerified: user.ownerVerifiedAt !== null,
      isLocked: isLockActive(user, now),
      deactivated: user.deletedAt !== null,
    },
    priorApplications: prior.map(toPriorRegistration),
  };
}
