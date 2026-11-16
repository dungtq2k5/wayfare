import { describe, expect, it } from 'vitest';
import { isActiveAccount, isLockActive } from './account-state';

const now = new Date('2026-09-17T12:00:00Z');
const later = new Date('2026-09-18T12:00:00Z');
const earlier = new Date('2026-09-16T12:00:00Z');
const open = { deletedAt: null, isLocked: false, lockedUntil: null };

describe('account state', () => {
  it('a lock holds while indefinite or unexpired', () => {
    expect(isLockActive({ isLocked: true, lockedUntil: null }, now)).toBe(true);
    expect(isLockActive({ isLocked: true, lockedUntil: later }, now)).toBe(true);
    expect(isLockActive({ isLocked: true, lockedUntil: earlier }, now)).toBe(false);
    expect(isLockActive({ isLocked: false, lockedUntil: null }, now)).toBe(false);
  });

  it('active means neither deactivated nor currently locked', () => {
    expect(isActiveAccount(open, now)).toBe(true);
    expect(isActiveAccount({ ...open, deletedAt: earlier }, now)).toBe(false);
    expect(isActiveAccount({ ...open, isLocked: true }, now)).toBe(false);
    expect(isActiveAccount({ ...open, isLocked: true, lockedUntil: earlier }, now)).toBe(true);
  });
});
