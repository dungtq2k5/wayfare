import { describe, expect, it } from 'vitest';
import { SYSTEM_CATEGORIES, systemCategory, TEST_CATEGORY_PREFIX } from './categories';
import { zCategoryCode } from './schemas';

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
