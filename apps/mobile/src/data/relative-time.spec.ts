import { describe, expect, it } from 'vitest';
import { relativeTime } from './relative-time';

const NOW = 10_000_000_000;

describe('relativeTime', () => {
  it.each([
    [0, { key: 'time.justNow' }],
    [59_000, { key: 'time.justNow' }],
    [60_000, { key: 'time.minutesAgo', count: 1 }],
    [59 * 60_000, { key: 'time.minutesAgo', count: 59 }],
    [60 * 60_000, { key: 'time.hoursAgo', count: 1 }],
    [23 * 3_600_000, { key: 'time.hoursAgo', count: 23 }],
    [24 * 3_600_000, { key: 'time.daysAgo', count: 1 }],
    [2.5 * 24 * 3_600_000, { key: 'time.daysAgo', count: 2 }],
  ])('%i ms ago', (ago, expected) => {
    expect(relativeTime(NOW, NOW - ago)).toEqual(expected);
  });

  it('treats a time in the future as just now', () => {
    expect(relativeTime(NOW, NOW + 5_000)).toEqual({ key: 'time.justNow' });
  });
});
