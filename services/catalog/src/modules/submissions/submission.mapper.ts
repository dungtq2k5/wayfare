import { submissionKindProto, submissionStatusProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { SubmissionKind, SubmissionStatus } from '@wayfare/contracts';

/** The columns a submission view reads. */
export const SUBMISSION_SELECT = {
  id: true,
  kind: true,
  status: true,
  placeId: true,
  ownerUserId: true,
  payload: true,
  payloadSchemaVersion: true,
  categoryCodeOverride: true,
  decisionNote: true,
  submittedAt: true,
  reviewedAt: true,
} as const;

/** One submission row as `SUBMISSION_SELECT` reads it. */
export interface SubmissionRow {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly placeId: string | null;
  readonly ownerUserId: string;
  readonly payload: unknown;
  readonly payloadSchemaVersion: number;
  readonly categoryCodeOverride: string | null;
  readonly decisionNote: string | null;
  readonly submittedAt: Date;
  readonly reviewedAt: Date | null;
}

/** A submission as its owner sees it — never the internal note (api-endpoints-plan §3.3). */
export function toSubmission(row: SubmissionRow): catalogGrpc.Submission {
  return {
    id: row.id,
    kind: submissionKindProto.toProto(row.kind as SubmissionKind),
    status: submissionStatusProto.toProto(row.status as SubmissionStatus),
    placeId: row.placeId ?? undefined,
    ownerUserId: row.ownerUserId,
    payloadJson: JSON.stringify(row.payload),
    payloadSchemaVersion: row.payloadSchemaVersion,
    categoryCodeOverride: row.categoryCodeOverride ?? undefined,
    decisionNote: row.decisionNote ?? undefined,
    submittedAt: toProtoTimestamp(row.submittedAt),
    reviewedAt: row.reviewedAt === null ? undefined : toProtoTimestamp(row.reviewedAt),
  };
}
