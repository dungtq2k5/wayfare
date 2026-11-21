// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createTranslator } from '../i18n/messages';
import { renderHook, settle } from '@wayfare/ui/testing';

vi.mock('../i18n/provider', () => ({ useConsole: () => createTranslator('en') }));
const api = vi.hoisted(() => ({
  categoriesList: vi.fn(() => Promise.resolve({ data: [{ code: 'CAFE' }] })),
  areasList: vi.fn(() => Promise.resolve({ data: [{ code: 'hcmc-d1-core' }] })),
}));
vi.mock('@wayfare/api-client', () => api);

const { useAreas, useCategories, useNames } = await import('./reference');

describe('the categories and areas (K4)', () => {
  it('reads each list once', async () => {
    const categories = await renderHook(() => useCategories());
    const areas = await renderHook(() => useAreas());
    await settle();
    expect(categories.current().data).toEqual([{ code: 'CAFE' }]);
    expect(areas.current().data).toEqual([{ code: 'hcmc-d1-core' }]);
  });

  it('names a category or an area from the app’s bundle, and an unknown one by its code', async () => {
    const names = (await renderHook(() => useNames())).current();
    expect(names.category('CAFE')).toBe(createTranslator('en').tDynamic('category.CAFE'));
    expect(names.category('NO_SUCH')).toBe('NO_SUCH');
    expect(names.area('no-such-area')).toBe('no-such-area');
  });
});
