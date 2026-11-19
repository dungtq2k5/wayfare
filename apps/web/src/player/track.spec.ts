import { describe, expect, it } from 'vitest';
import { clock } from './track';

describe('the player’s clock', () => {
  it('reads m:ss, whole seconds down, never below zero', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(9_999)).toBe('0:09');
    expect(clock(135_000)).toBe('2:15');
    expect(clock(-500)).toBe('0:00');
  });
});
