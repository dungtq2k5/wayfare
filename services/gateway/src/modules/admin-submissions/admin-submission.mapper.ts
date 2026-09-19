import {
  SUBMISSION_EDITABLE_FIELDS,
  zEntitlements,
  zSubmissionDiffEntry,
} from '@wayfare/contracts';
import type { SubmissionEditableField } from '@wayfare/contracts';
import { submissionKindProto, submissionStatusProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { z } from 'zod';
import { toAdminPlaceResponseDto } from '../admin-places/admin-place.mapper';
import { toSubmissionResponseDto } from '../owner-submissions/owner-submission.mapper';
import type { AdminSubmissionResponseDto } from './dto/admin-submission-response.dto';
import type {
  ApproveSubmissionDto,
  RejectSubmissionDto,
  SubmissionQueueQueryDto,
} from './dto/admin-submission.dto';

const isEditableField = (value: string): value is SubmissionEditableField =>
  (SUBMISSION_EDITABLE_FIELDS as readonly string[]).includes(value);

/** catalog's review view; its diff and the owner's grants travel as JSON. */
export function toAdminSubmissionResponseDto(
  view: catalogGrpc.SubmissionAdmin | undefined,
): AdminSubmissionResponseDto {
  if (view == null) throw new Error('A response arrived without its submission');
  return {
    submission: toSubmissionResponseDto(view.submission),
    internalNote: view.internalNote ?? null,
    reviewedById: view.reviewedById ?? null,
    livePlace: view.livePlace == null ? null : toAdminPlaceResponseDto(view.livePlace),
    diff: z.array(zSubmissionDiffEntry).parse(JSON.parse(view.diffJson)),
    entitlements:
      view.entitlementsJson == null ? null : zEntitlements.parse(JSON.parse(view.entitlementsJson)),
    conflict: { changedFields: view.conflictChangedFields.filter(isEditableField) },
  };
}

export function toListSubmissionsRequest(
  query: SubmissionQueueQueryDto,
): catalogGrpc.ListSubmissionsRequest {
  return {
    page: { page: query.page, pageSize: query.pageSize, sort: '' },
    status: submissionStatusProto.toProto(query.status),
    kind: query.kind === undefined ? undefined : submissionKindProto.toProto(query.kind),
    areaId: query.areaId,
  };
}

export function toApproveSubmissionRequest(
  submissionId: string,
  body: ApproveSubmissionDto,
): catalogGrpc.ApproveSubmissionRequest {
  return {
    submissionId,
    triggerRadiusM: body.triggerRadiusM,
    narrationPriority: body.narrationPriority,
    categoryCodeOverride: body.categoryCodeOverride,
    decisionNote: body.decisionNote,
    internalNote: body.internalNote,
    acknowledgeConflict: body.acknowledgeConflict,
  };
}

export function toRejectSubmissionRequest(
  submissionId: string,
  body: RejectSubmissionDto,
): catalogGrpc.RejectSubmissionRequest {
  return { submissionId, decisionNote: body.decisionNote, internalNote: body.internalNote };
}
