import { describe, expect, it } from 'vitest';
import { formatDate, formatDuration, formatPhone, formatTime } from './format';

describe('the console’s formats', () => {
  it('writes a date as day, short month, year in both languages', () => {
    expect(formatDate('2026-10-02T09:00:00.000Z', 'en')).toBe('2 Oct 2026');
    expect(formatDate('2026-10-02T09:00:00.000Z', 'vi')).toMatch(/^2 .*10.* 2026$/);
  });

  it('writes a time in 24 hours with no AM or PM', () => {
    expect(formatTime('2026-10-02T14:05:00', 'en')).toBe('14:05');
    expect(formatTime('2026-10-02T09:05:00', 'en')).toBe('09:05');
  });

  it('writes a Vietnamese phone number in its national groups', () => {
    expect(formatPhone('+842839401234')).toBe('028 3940 1234');
    expect(formatPhone('+84908123456')).toBe('090 812 3456');
    expect(formatPhone('+14155550100')).toBe('+14155550100');
  });

  it('writes a narration’s length in minutes and seconds', () => {
    expect(formatDuration(134_000)).toBe('2:14');
    expect(formatDuration(9_400)).toBe('0:09');
  });
});
