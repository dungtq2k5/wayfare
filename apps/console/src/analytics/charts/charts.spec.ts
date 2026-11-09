import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../i18n/messages';
import { formatCount, formatHour, formatHours, formatListening, formatPercent } from './format';
import { niceTicks, tickIndexes } from './ticks';

describe('the axis', () => {
  it('rounds four ticks from zero to a nice step that reaches the tallest bar', () => {
    expect(niceTicks(118)).toEqual([0, 40, 80, 120]);
    expect(niceTicks(7)).toEqual([0, 2.5, 5, 7.5]);
    expect(niceTicks(3412)).toEqual([0, 2000, 4000, 6000]);
    expect(niceTicks(0)).toEqual([0, 1, 2, 3]);
  });

  it('spreads about five X ticks, the first and the last among them', () => {
    expect(tickIndexes(30)).toEqual([0, 7, 15, 22, 29]);
    expect(tickIndexes(3)).toEqual([0, 1, 2]);
  });
});

describe('the numbers, in the console’s language', () => {
  const en = createTranslator('en');
  const vi = createTranslator('vi');

  it('groups counts and writes rates and listening as the frames do', () => {
    expect(formatCount(3412, 'en')).toBe('3,412');
    expect(formatCount(3412, 'vi')).toBe('3.412');
    expect(formatPercent(0.68, 'en', en.t)).toBe('68 %');
    expect(formatListening(108_000, en.t)).toBe('1 min 48 s');
    expect(formatListening(42_000, en.t)).toBe('42 s');
    expect(formatListening(108_000, vi.t)).toBe('1 phút 48 giây');
    expect(formatHours(18_300_000, 'en', en.t)).toBe('5 h 5 min');
  });

  it('writes an hour in Vietnam time', () => {
    expect(formatHour('2026-11-05T11:00:00Z', 'en')).toBe('Thu 18:00');
  });
});
