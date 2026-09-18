import { OwnerRegistrationStatus, parseEnum } from '@wayfare/contracts';
import { ownerRegistrationStatusProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';

/**
 * The columns the applicant's view reads (rdm-spec I-8). Neither the ciphertext nor the staff note
 * is selected, so neither can reach an owner route.
 */
export const OWNER_REGISTRATION_SELECT = {
  id: true,
  status: true,
  businessName: true,
  businessAddress: true,
  businessRegistrationNo: true,
  contactName: true,
  contactPhone: true,
  nationalIdLast4: true,
  applicantNote: true,
  decisionNote: true,
  submittedAt: true,
  reviewedAt: true,
} as const satisfies Prisma.OwnerRegistrationSelect;

/** An application as `OWNER_REGISTRATION_SELECT` loads it. */
export type OwnerRegistrationRow = Prisma.OwnerRegistrationGetPayload<{
  select: typeof OWNER_REGISTRATION_SELECT;
}>;

/** The applicant's view. It has no staff note field to fill. */
export function toOwnerRegistration(row: OwnerRegistrationRow): identityGrpc.OwnerRegistration {
  return {
    id: row.id,
    status: ownerRegistrationStatusProto.toProto(parseEnum(OwnerRegistrationStatus, row.status)),
    businessName: row.businessName,
    businessAddress: row.businessAddress,
    ...(row.businessRegistrationNo === null
      ? {}
      : { businessRegistrationNo: row.businessRegistrationNo }),
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    ...(row.nationalIdLast4 === null ? {} : { nationalIdLast4: row.nationalIdLast4 }),
    ...(row.applicantNote === null ? {} : { applicantNote: row.applicantNote }),
    ...(row.decisionNote === null ? {} : { decisionNote: row.decisionNote }),
    submittedAt: toProtoTimestamp(row.submittedAt),
    reviewedAt: row.reviewedAt === null ? undefined : toProtoTimestamp(row.reviewedAt),
  };
}

/** `/users/me`'s open application. */
export function toPendingRegistration(row: {
  readonly id: string;
  readonly submittedAt: Date;
}): identityGrpc.PendingRegistration {
  return { id: row.id, submittedAt: toProtoTimestamp(row.submittedAt) };
}
