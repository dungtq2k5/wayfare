import type { OwnerRegistration, OwnerRegistrationStatus } from '@wayfare/contracts';
import { ownerRegistrationStatusProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { fromOptionalProtoTimestamp, fromProtoTimestamp } from '@wayfare/nest-common';
import type { SubmitRegistrationDto } from './dto/owner-registration.dto';

/** A status this build knows; any other is a server fault. */
export function toOwnerRegistrationStatus(value: number): OwnerRegistrationStatus {
  const status = ownerRegistrationStatusProto.fromProto(value);
  if (status === null) throw new Error('A registration carries an unknown status');
  return status;
}

/** The applicant's view, field by field; an absent optional becomes `null` (conventions §6.3). */
export function toOwnerRegistration(
  registration: identityGrpc.OwnerRegistration | undefined,
): OwnerRegistration {
  if (registration === undefined) throw new Error('A response arrived without its registration');
  return {
    id: registration.id,
    status: toOwnerRegistrationStatus(registration.status),
    businessName: registration.businessName,
    businessAddress: registration.businessAddress,
    businessRegistrationNo: registration.businessRegistrationNo ?? null,
    contactName: registration.contactName,
    contactPhone: registration.contactPhone,
    nationalIdLast4: registration.nationalIdLast4 ?? null,
    applicantNote: registration.applicantNote ?? null,
    decisionNote: registration.decisionNote ?? null,
    submittedAt: fromProtoTimestamp(registration.submittedAt, 'submittedAt').toISOString(),
    reviewedAt:
      fromOptionalProtoTimestamp(registration.reviewedAt, 'reviewedAt')?.toISOString() ?? null,
  };
}

/** The `SubmitRegistration` request: only the fields the body carries. */
export function toSubmitRegistrationRequest(
  body: SubmitRegistrationDto,
): identityGrpc.SubmitRegistrationRequest {
  return {
    businessName: body.businessName,
    businessAddress: body.businessAddress,
    ...(body.businessRegistrationNo === undefined
      ? {}
      : { businessRegistrationNo: body.businessRegistrationNo }),
    contactName: body.contactName,
    contactPhone: body.contactPhone,
    nationalId: body.nationalId,
    ...(body.applicantNote === undefined ? {} : { applicantNote: body.applicantNote }),
    ownerAgreementVersion: body.ownerAgreementVersion,
  };
}
