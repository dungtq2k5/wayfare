import { CATEGORY_ICONS } from '@wayfare/contracts';
import { describe, expect, it, vi } from 'vitest';

// The icons are components; the mapping is what's under test, so each is its own name.
vi.mock('lucide-react-native', () =>
  Object.fromEntries(
    [
      'Amphora',
      'Binoculars',
      'Church',
      'Coffee',
      'Landmark',
      'MapPin',
      'Soup',
      'Store',
      'Trees',
      'Utensils',
    ].map((name) => [name, name]),
  ),
);

const { areaIcon, CATEGORY_CODES, categoryIcon } = await import('./categories');
const { categoryKey } = await import('./category-key');

describe('category and area icons', () => {
  it('draws each category with the icon contracts names, and an unknown one with the pin', () => {
    expect(categoryIcon('CAFE')).toBe('Coffee');
    expect(categoryIcon('NO_SUCH_CATEGORY')).toBe('MapPin');
  });

  it('gives every category a known icon', () => {
    for (const code of Object.keys(CATEGORY_ICONS)) expect(categoryIcon(code)).toBeTypeOf('string');
  });

  it('offers every category as a chip but Other', () => {
    expect(CATEGORY_CODES).not.toContain('OTHER');
    expect(CATEGORY_CODES.length).toBe(Object.keys(CATEGORY_ICONS).length - 1);
  });

  it('draws an area by its code, a new one with the pin', () => {
    expect(areaIcon('hcmc-d1-core')).toBe('Landmark');
    expect(areaIcon('hcmc-d4-vinh-khanh')).toBe('Soup');
    expect(areaIcon('hanoi-old-quarter')).toBe('MapPin');
  });
});

describe('a category’s marker key', () => {
  it('is its own code for a category the app draws, OTHER for any other', () => {
    expect(categoryKey('CAFE')).toBe('CAFE');
    expect(categoryKey('NO_SUCH_CATEGORY')).toBe('OTHER');
  });
});
