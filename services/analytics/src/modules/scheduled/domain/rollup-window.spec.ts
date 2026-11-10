import { describe, expect, it } from 'vitest';
import { daysBefore, morningAfter, rebuildable, rebuildWindow } from './rollup-window';

describe('the nightly rebuild’s days', () => {
  it('covers yesterday and the 7 before it, in Vietnam’s days', () => {
    // 03:00 on 7 November in Vietnam is still the 6th in UTC.
    const days = rebuildWindow(new Date('2026-11-06T20:00:00Z'));
    expect(days).toHaveLength(8);
    expect(days[0]).toBe('2026-10-30');
    expect(days.at(-1)).toBe('2026-11-06');
  });

  it('refuses today and a day past the raw events’ 90 days', () => {
    const now = new Date('2026-11-07T05:00:00Z');
    expect(rebuildable('2026-11-06', now)).toBe(true);
    expect(rebuildable('2026-11-07', now)).toBe(false);
    expect(rebuildable(daysBefore('2026-11-07', 90), now)).toBe(true);
    expect(rebuildable(daysBefore('2026-11-07', 91), now)).toBe(false);
  });

  it('keeps a seed’s fixed days rebuildable with the seed’s own clock, a year on', () => {
    const clock = morningAfter('2026-11-06');
    expect(clock.toISOString()).toBe('2026-11-06T20:00:00.000Z');
    const days = Array.from({ length: 28 }, (_, index) => daysBefore('2026-11-06', index));
    expect(days.every((day) => rebuildable(day, clock))).toBe(true);
    // The real clock a year later would refuse them all.
    expect(days.some((day) => rebuildable(day, new Date('2027-11-06T05:00:00Z')))).toBe(false);
  });
});
