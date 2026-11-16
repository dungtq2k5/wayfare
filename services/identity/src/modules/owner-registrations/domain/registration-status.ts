import { OwnerRegistrationStatus, PII_RETENTION_DAYS } from '@wayfare/contracts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The moves an application may make (rdm-spec I-8). Only `PENDING` moves; the rest are final. */
export const REGISTRATION_TRANSITIONS: Readonly<
  Record<OwnerRegistrationStatus, readonly OwnerRegistrationStatus[]>
> = {
  [OwnerRegistrationStatus.PENDING]: [
    OwnerRegistrationStatus.APPROVED,
    OwnerRegistrationStatus.REJECTED,
    OwnerRegistrationStatus.WITHDRAWN,
  ],
  [OwnerRegistrationStatus.APPROVED]: [],
  [OwnerRegistrationStatus.REJECTED]: [],
  [OwnerRegistrationStatus.WITHDRAWN]: [],
};

/** True when `from` may become `to`. */
export function canTransition(from: OwnerRegistrationStatus, to: OwnerRegistrationStatus): boolean {
  return REGISTRATION_TRANSITIONS[from].includes(to);
}

/** The columns that decide when a row's national ID is due for redaction. */
export interface RedactionFacts {
  readonly status: OwnerRegistrationStatus;
  readonly reviewedAt: Date | null;
  readonly updatedAt: Date;
  readonly piiRedactedAt: Date | null;
}

/** Rows whose clock started at or before this instant are due at `now`. */
export function redactionCutoff(now: Date): Date {
  return new Date(now.getTime() - PII_RETENTION_DAYS * DAY_MS);
}

/**
 * Due for redaction at `now` (rdm-spec I-8): decided and reviewed, or withdrawn, at least
 * `PII_RETENTION_DAYS` ago, and not redacted yet. A `PENDING` row never is — it still needs review.
 */
export function isRedactionDue(row: RedactionFacts, now: Date): boolean {
  if (row.piiRedactedAt !== null) return false;
  const cutoff = redactionCutoff(now).getTime();
  switch (row.status) {
    case OwnerRegistrationStatus.APPROVED:
    case OwnerRegistrationStatus.REJECTED:
      return row.reviewedAt !== null && row.reviewedAt.getTime() <= cutoff;
    case OwnerRegistrationStatus.WITHDRAWN:
      return row.updatedAt.getTime() <= cutoff;
    case OwnerRegistrationStatus.PENDING:
      return false;
  }
}
