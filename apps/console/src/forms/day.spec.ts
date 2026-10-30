import { describe, expect, it } from 'vitest';
import { parseDay } from './day';

describe('parseDay', () => {
  it.each([
    ['30 Oct 2026', '2026-10-30'],
    ['30 October 2026', '2026-10-30'],
    ['30 thg 10, 2026', '2026-10-30'],
    ['30/10/2026', '2026-10-30'],
    ['3.1.2027', '2027-01-03'],
    ['2026-10-30', '2026-10-30'],
  ])('%s → %s', (text, day) => {
    expect(parseDay(text)).toBe(day);
  });

  it.each(['', '31 Feb 2026', '10/30/2026', 'tomorrow', '30 Oct'])('refuses %j', (text) => {
    expect(parseDay(text)).toBeNull();
  });
});
