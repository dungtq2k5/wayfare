import { describe, expect, it } from 'vitest';
import { leavesActiveSuperAdmin } from './super-admin-guard';

const a = { userId: 'a', active: true };
const b = { userId: 'b', active: true };

describe('leavesActiveSuperAdmin', () => {
  it('removing one of two active holders leaves one', () => {
    expect(leavesActiveSuperAdmin([a, b], { kind: 'REMOVE_ROLE', userId: 'a' })).toBe(true);
  });

  it('removing, locking or deactivating the last one is refused', () => {
    for (const kind of ['REMOVE_ROLE', 'LOCK', 'DEACTIVATE'] as const) {
      expect(leavesActiveSuperAdmin([a], { kind, userId: 'a' })).toBe(false);
    }
  });

  it('a locked or deactivated second holder does not count', () => {
    const inactive = { userId: 'b', active: false };
    expect(leavesActiveSuperAdmin([a, inactive], { kind: 'LOCK', userId: 'a' })).toBe(false);
    expect(leavesActiveSuperAdmin([a, inactive], { kind: 'DEACTIVATE', userId: 'a' })).toBe(false);
  });

  it('changing an inactive holder, or a non-holder, removes nobody', () => {
    const inactive = { userId: 'b', active: false };
    expect(leavesActiveSuperAdmin([a, inactive], { kind: 'REMOVE_ROLE', userId: 'b' })).toBe(true);
    expect(leavesActiveSuperAdmin([a], { kind: 'LOCK', userId: 'c' })).toBe(true);
  });
});
