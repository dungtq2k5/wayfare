import { legalDocumentProto, legalPartyProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { fromProtoTimestamp } from '@wayfare/nest-common';
import type { LegalAcceptanceStatusResponseDto } from './dto/legal-acceptance-response.dto';
import type { MeResponseDto, UserResponseDto } from './dto/user-response.dto';
import type { UpdateMeDto } from './dto/user.dto';

/** The account, field by field; an absent optional becomes `null` (conventions §6.3). */
export function toUserResponseDto(user: identityGrpc.SessionUser | undefined): UserResponseDto {
  if (user === undefined) throw new Error('A response arrived without its user');
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName ?? null,
    preferredLocale: user.preferredLocale,
    isEmailVerified: user.isEmailVerified,
    emailBounced: user.emailBounced,
    createdAt: fromProtoTimestamp(user.createdAt, 'createdAt').toISOString(),
  };
}

/** `GET /users/me`. An unset message field may arrive as `null` from the proto loader. */
export function toMeResponseDto(response: identityGrpc.GetMeResponse): MeResponseDto {
  const owner = response.owner ?? null;
  const pending = owner?.pendingRegistration ?? null;
  return {
    user: toUserResponseDto(response.user),
    roles: [...response.roles],
    permissions: [...response.permissions],
    ownerVerified: response.ownerVerified,
    owner:
      owner === null
        ? null
        : {
            pendingRegistration:
              pending === null
                ? null
                : {
                    id: pending.id,
                    submittedAt: fromProtoTimestamp(
                      pending.submittedAt,
                      'owner.pendingRegistration.submittedAt',
                    ).toISOString(),
                  },
          },
  };
}

/** The `UpdateMe` request: only the fields the body carries. */
export function toUpdateMeRequest(body: UpdateMeDto): identityGrpc.UpdateMeRequest {
  return {
    ...(body.fullName === undefined ? {} : { fullName: body.fullName }),
    ...(body.preferredLocale === undefined ? {} : { preferredLocale: body.preferredLocale }),
  };
}

/** One acceptance with its `current` flag. An enum this build cannot read is a server fault. */
export function toLegalAcceptanceStatusResponseDto(
  acceptance: identityGrpc.LegalAcceptance,
): LegalAcceptanceStatusResponseDto {
  const party = legalPartyProto.fromProto(acceptance.party);
  const document = legalDocumentProto.fromProto(acceptance.document);
  if (party === null || document === null)
    throw new Error('A legal acceptance carries an unknown enum value');
  return {
    party,
    document,
    version: acceptance.version,
    acceptedAt: fromProtoTimestamp(acceptance.acceptedAt, 'acceptedAt').toISOString(),
    current: acceptance.current,
  };
}
