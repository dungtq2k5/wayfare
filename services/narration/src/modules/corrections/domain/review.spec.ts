import { OverrideStatus } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { isListed, needsReview } from './review';

const hash = 'a'.repeat(64);
const other = 'b'.repeat(64);
const active = { status: OverrideStatus.ACTIVE, sourceContentHash: hash, revertedById: null };

describe('needsReview', () => {
  it('an active correction on the current Vietnamese is in use', () => {
    expect(needsReview(active, hash)).toBe(false);
  });

  it('an active correction on a stale Vietnamese needs review', () => {
    expect(needsReview(active, other)).toBe(true);
  });

  it('one a Vietnamese change superseded (reverted by nobody) needs review', () => {
    expect(needsReview({ ...active, status: OverrideStatus.REVERTED }, hash)).toBe(true);
  });

  it("a person's revert needs nothing, and is not listed", () => {
    const reverted = { ...active, status: OverrideStatus.REVERTED, revertedById: 'someone' };
    expect(needsReview(reverted, hash)).toBe(false);
    expect(isListed(reverted)).toBe(false);
    expect(isListed({ ...active, status: OverrideStatus.REVERTED })).toBe(true);
    expect(isListed(active)).toBe(true);
  });

  it('without the current Vietnamese, an active one is taken as in use', () => {
    expect(needsReview(active, null)).toBe(false);
  });
});
