import { OverrideStatus } from '@wayfare/contracts';

/** What deciding a correction's review needs. */
export interface ReviewedRow {
  readonly status: string;
  readonly sourceContentHash: string;
  readonly revertedById: string | null;
}

/**
 * Whether a correction no longer matches the Vietnamese (rdm-spec N-7): one a Vietnamese change
 * superseded — reverted by nobody — or one still active on a source that has moved on (until the
 * next synthesis supersedes it). A person's revert needs nothing.
 */
export function needsReview(row: ReviewedRow, currentHash: string | null): boolean {
  if (row.status === (OverrideStatus.REVERTED as string)) return row.revertedById === null;
  return currentHash !== null && row.sourceContentHash !== currentHash;
}

/** Whether a language's latest correction is listed at all: in use, or needing review. */
export function isListed(row: ReviewedRow): boolean {
  return row.status === (OverrideStatus.ACTIVE as string) || row.revertedById === null;
}
