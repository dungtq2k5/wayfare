import type { Entitlements, SubmissionDiffEntry } from '@wayfare/contracts';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { SUBMISSION_SELECT, toSubmission } from '../submissions/submission.mapper';
import type { SubmissionRow } from '../submissions/submission.mapper';

/** The columns a reviewer's view reads: the owner's view and the staff fields. */
export const REVIEW_SELECT = {
  ...SUBMISSION_SELECT,
  internalNote: true,
  reviewedById: true,
  baseSnapshot: true,
} as const;

/** A submission as a reviewer sees it (api-endpoints-plan §3.4). */
export function toSubmissionAdmin(
  row: SubmissionRow & {
    readonly internalNote: string | null;
    readonly reviewedById: string | null;
  },
  extras: {
    readonly livePlace: catalogGrpc.AdminPlace | null;
    readonly diff: readonly SubmissionDiffEntry[];
    readonly entitlements: Entitlements | null;
    readonly conflict: readonly string[];
  },
): catalogGrpc.SubmissionAdmin {
  return {
    submission: toSubmission(row),
    internalNote: row.internalNote ?? undefined,
    reviewedById: row.reviewedById ?? undefined,
    livePlace: extras.livePlace ?? undefined,
    diffJson: JSON.stringify(extras.diff),
    entitlementsJson:
      extras.entitlements === null ? undefined : JSON.stringify(extras.entitlements),
    conflictChangedFields: [...extras.conflict],
  };
}
