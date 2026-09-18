import type { OwnerRegistrationAdmin, OwnerRegistrationAdminItem } from '@wayfare/contracts';
import { ownerRegistrationStatusProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { fromOptionalProtoTimestamp, fromProtoTimestamp } from '@wayfare/nest-common';
import {
  toOwnerRegistration,
  toOwnerRegistrationStatus,
} from '../owner-registration/owner-registration.mapper';
import type { OwnerRegistrationQueueQueryDto } from './dto/admin-owner-registration.dto';

/** The `ListRegistrations` request. The order is fixed by status, so no sort travels. */
export function toListRegistrationsRequest(
  query: OwnerRegistrationQueueQueryDto,
): identityGrpc.ListRegistrationsRequest {
  return {
    page: {
      page: query.page,
      pageSize: query.pageSize,
      sort: '',
      ...(query.q === undefined ? {} : { q: query.q }),
    },
    status: ownerRegistrationStatusProto.toProto(query.status),
  };
}

/** A queue row; an absent optional becomes `null` (conventions §6.3). */
export function toOwnerRegistrationAdminItem(
  item: identityGrpc.OwnerRegistrationAdminItem,
): OwnerRegistrationAdminItem {
  if (item.applicant === undefined) throw new Error('A queue row arrived without its applicant');
  return {
    ...toOwnerRegistration(item.registration),
    internalNote: item.internalNote ?? null,
    reviewedById: item.reviewedById ?? null,
    piiRedacted: item.piiRedacted,
    applicant: {
      id: item.applicant.id,
      email: item.applicant.email,
      fullName: item.applicant.fullName ?? null,
    },
  };
}

/** The review detail. */
export function toOwnerRegistrationAdmin(
  detail: identityGrpc.OwnerRegistrationAdmin | undefined,
): OwnerRegistrationAdmin {
  if (detail?.applicant === undefined) {
    throw new Error('A response arrived without its registration');
  }
  const { applicant } = detail;
  return {
    ...toOwnerRegistration(detail.registration),
    internalNote: detail.internalNote ?? null,
    reviewedById: detail.reviewedById ?? null,
    piiRedacted: detail.piiRedacted,
    applicant: {
      id: applicant.id,
      email: applicant.email,
      fullName: applicant.fullName ?? null,
      createdAt: fromProtoTimestamp(applicant.createdAt, 'applicant.createdAt').toISOString(),
      emailVerified: applicant.emailVerified,
      ownerVerified: applicant.ownerVerified,
      isLocked: applicant.isLocked,
      deactivated: applicant.deactivated,
    },
    priorApplications: detail.priorApplications.map((prior) => ({
      id: prior.id,
      status: toOwnerRegistrationStatus(prior.status),
      submittedAt: fromProtoTimestamp(prior.submittedAt, 'prior.submittedAt').toISOString(),
      reviewedAt:
        fromOptionalProtoTimestamp(prior.reviewedAt, 'prior.reviewedAt')?.toISOString() ?? null,
    })),
  };
}
