import { OwnerRegistrationStatus, PII_RETENTION_DAYS } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { canTransition, isRedactionDue, redactionCutoff } from './registration-status';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date('2027-03-01T00:00:00.000Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

describe('canTransition', () => {
  it('moves only a PENDING application', () => {
    for (const to of [
      OwnerRegistrationStatus.APPROVED,
      OwnerRegistrationStatus.REJECTED,
      OwnerRegistrationStatus.WITHDRAWN,
    ]) {
      expect(canTransition(OwnerRegistrationStatus.PENDING, to)).toBe(true);
      expect(canTransition(to, OwnerRegistrationStatus.PENDING)).toBe(false);
    }
    expect(canTransition(OwnerRegistrationStatus.APPROVED, OwnerRegistrationStatus.WITHDRAWN)).toBe(
      false,
    );
  });
});

describe('isRedactionDue', () => {
  const base = { reviewedAt: null, updatedAt: now, piiRedactedAt: null };

  it('counts from the review for a decision, inclusive at the edge', () => {
    for (const status of [OwnerRegistrationStatus.APPROVED, OwnerRegistrationStatus.REJECTED]) {
      expect(
        isRedactionDue({ ...base, status, reviewedAt: daysAgo(PII_RETENTION_DAYS) }, now),
      ).toBe(true);
      expect(
        isRedactionDue(
          { ...base, status, reviewedAt: new Date(daysAgo(PII_RETENTION_DAYS).getTime() + 1) },
          now,
        ),
      ).toBe(false);
    }
  });

  it('counts from the last update for a withdrawal', () => {
    const status = OwnerRegistrationStatus.WITHDRAWN;
    expect(isRedactionDue({ ...base, status, updatedAt: daysAgo(PII_RETENTION_DAYS) }, now)).toBe(
      true,
    );
    expect(isRedactionDue({ ...base, status, updatedAt: daysAgo(10) }, now)).toBe(false);
  });

  it('never redacts a pending row or one already redacted', () => {
    expect(
      isRedactionDue(
        { ...base, status: OwnerRegistrationStatus.PENDING, updatedAt: daysAgo(1000) },
        now,
      ),
    ).toBe(false);
    expect(
      isRedactionDue(
        {
          status: OwnerRegistrationStatus.APPROVED,
          reviewedAt: daysAgo(1000),
          updatedAt: now,
          piiRedactedAt: daysAgo(1),
        },
        now,
      ),
    ).toBe(false);
  });

  it('puts the cutoff PII_RETENTION_DAYS back', () => {
    expect(redactionCutoff(now)).toEqual(daysAgo(PII_RETENTION_DAYS));
  });
});
