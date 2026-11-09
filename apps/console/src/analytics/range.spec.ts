import { describe, expect, it } from 'vitest';
import { customProblem, daysIn, parseRange, rangeDays, rangeQuery } from './range';

describe('the range', () => {
  it('ends a quick range yesterday in Vietnam, starting n − 1 days before', () => {
    // 2026-11-07 00:30 in Vietnam is still 6 November in UTC: yesterday is the 6th.
    const now = new Date('2026-11-06T17:30:00Z');
    expect(rangeDays({ kind: 'quick', days: 30 }, now)).toEqual({
      from: '2026-10-08',
      to: '2026-11-06',
    });
    expect(rangeDays({ kind: 'quick', days: 7 }, now)).toEqual({
      from: '2026-10-31',
      to: '2026-11-06',
    });
    expect(daysIn('2026-10-08', '2026-11-06')).toBe(30);
  });

  it('refuses a custom range over 93 days, or backwards, before anything is asked', () => {
    expect(customProblem('2026-08-06', '2026-11-06')).toBe(null);
    expect(daysIn('2026-08-06', '2026-11-06')).toBe(93);
    expect(customProblem('2026-08-05', '2026-11-06')).toBe('tooLong');
    expect(customProblem('2026-11-06', '2026-11-01')).toBe('order');
    expect(customProblem('6 Nov', '2026-11-01')).toBe('order');
  });

  it('round-trips the address, keeping its other parameters; 30 days by default', () => {
    const custom = { kind: 'custom', from: '2026-10-01', to: '2026-10-31' } as const;
    const query = rangeQuery(new URLSearchParams('metric=started&range=7'), custom);
    expect(query).toBe('metric=started&from=2026-10-01&to=2026-10-31');
    expect(parseRange(new URLSearchParams(query))).toEqual(custom);
    expect(parseRange(new URLSearchParams('range=90'))).toEqual({ kind: 'quick', days: 90 });
    expect(parseRange(new URLSearchParams('range=12'))).toEqual({ kind: 'quick', days: 30 });
    // A range the server would refuse never comes from the address.
    expect(parseRange(new URLSearchParams('from=2026-01-01&to=2026-11-01'))).toEqual({
      kind: 'quick',
      days: 30,
    });
  });
});
