import { zPlaceSubmissionPayload } from '@wayfare/contracts';
import { submissionKindProto, submissionStatusProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { fromOptionalProtoTimestamp, fromProtoTimestamp } from '@wayfare/nest-common';
import type { SubmissionResponseDto } from './dto/owner-submission-response.dto';
import type { CreateSubmissionDto, OwnerSubmissionsQueryDto } from './dto/owner-submission.dto';

/** An enum this build cannot read is catalog's fault, never the caller's. */
function known<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`catalog sent an unknown ${what}`);
  return value;
}

/** catalog's submission; its payload travels as JSON (rdm-spec §2.5). */
export function toSubmissionResponseDto(
  submission: catalogGrpc.Submission | undefined,
): SubmissionResponseDto {
  if (submission == null) throw new Error('A response arrived without its submission');
  return {
    id: submission.id,
    kind: known(submissionKindProto.fromProto(submission.kind), 'kind'),
    status: known(submissionStatusProto.fromProto(submission.status), 'status'),
    placeId: submission.placeId ?? null,
    ownerUserId: submission.ownerUserId,
    payload: zPlaceSubmissionPayload.parse(JSON.parse(submission.payloadJson)),
    payloadSchemaVersion: submission.payloadSchemaVersion,
    categoryCodeOverride: submission.categoryCodeOverride ?? null,
    decisionNote: submission.decisionNote ?? null,
    submittedAt: fromProtoTimestamp(submission.submittedAt, 'submittedAt').toISOString(),
    reviewedAt:
      fromOptionalProtoTimestamp(submission.reviewedAt, 'reviewedAt')?.toISOString() ?? null,
  };
}

/** The body, with the payload as the JSON catalog stores. */
export function toCreateSubmissionRequest(
  body: CreateSubmissionDto,
): catalogGrpc.CreateSubmissionRequest {
  return {
    kind: submissionKindProto.toProto(body.kind),
    placeId: body.placeId,
    baseEditableHash: body.baseEditableHash,
    payloadJson: JSON.stringify(body.payload),
  };
}

export function toListMySubmissionsRequest(
  query: OwnerSubmissionsQueryDto,
): catalogGrpc.ListMySubmissionsRequest {
  return {
    page: { cursor: query.cursor, limit: query.limit },
    placeId: query.placeId,
    status: query.status === undefined ? undefined : submissionStatusProto.toProto(query.status),
  };
}
