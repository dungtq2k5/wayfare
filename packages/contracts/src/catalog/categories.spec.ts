import { describe, expect, it } from 'vitest';
import { SYSTEM_CATEGORIES, systemCategory, TEST_CATEGORY_PREFIX } from './categories';
import { zCategoryCode } from './schemas';
import { CATEGORY_ICONS, categoryIconName } from './category-icons';

describe('SYSTEM_CATEGORIES', () => {
  it('holds valid, unique codes and unique sort orders, none with the test prefix', () => {
    const codes = SYSTEM_CATEGORIES.map((entry) => entry.code);
    expect(codes).toHaveLength(10);
    for (const code of codes) {
      expect(zCategoryCode.safeParse(code).success, code).toBe(true);
      expect(code.startsWith(TEST_CATEGORY_PREFIX), code).toBe(false);
    }
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(SYSTEM_CATEGORIES.map((entry) => entry.sortOrder)).size).toBe(codes.length);
    expect(SYSTEM_CATEGORIES.every((entry) => entry.icon === entry.code.toLowerCase())).toBe(true);
  });

  it('finds an entry by code', () => {
    expect(systemCategory('MARKET')?.appliesTo).toBe('ANY');
    expect(systemCategory('NOPE')).toBeUndefined();
  });
});

describe('categoryIconName', () => {
  it("draws a mapped code's icon, and a new code as the pin", () => {
    expect(categoryIconName('STREET_FOOD')).toBe('soup');
    expect(categoryIconName('NIGHT_MARKET')).toBe('map-pin');
  });

  it('maps every system category', () => {
    for (const entry of SYSTEM_CATEGORIES)
      expect(Object.hasOwn(CATEGORY_ICONS, entry.code)).toBe(true);
  });
});
