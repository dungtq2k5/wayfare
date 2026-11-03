import { describe, expect, it } from 'vitest';
import { distance, formatDate, linkCode, price, printedCode, weekdayName } from './format';

describe('the Place page formats', () => {
  it("writes đồng in Vietnam's form whatever the page's language, dollars in theirs", () => {
    expect(price(85000, 'VND', 'en')).toBe('85.000 ₫');
    expect(price(450, 'USD', 'en')).toBe('$4.50');
  });

  it('writes a code as printed on the sticker and as a link', () => {
    expect(printedCode('z63tcmmt')).toBe('Z63T CMMT');
    expect(linkCode('Z63TCMMT')).toBe('Z63T-CMMT');
  });

  it('gives metres under a kilometre, then kilometres', () => {
    expect(distance(118, 'en')).toEqual({ unit: 'm', n: '120' });
    expect(distance(1450, 'en')).toEqual({ unit: 'km', n: '1.5' });
  });

  it('names an ISO weekday in the page language', () => {
    expect(weekdayName(1, 'en')).toBe('Mon');
    expect(weekdayName(7, 'en', 'long')).toBe('Sunday');
  });

  it('writes a date as day, short month, year in every language', () => {
    const day = new Date('2026-09-01T00:00:00Z');
    expect(formatDate(day, 'en', 'UTC')).toBe('1 Sep 2026');
    expect(formatDate(day, 'vi', 'UTC')).toBe('1 thg 9, 2026');
    expect(formatDate(day, 'fr', 'UTC')).toBe('1 sept. 2026');
  });
});
