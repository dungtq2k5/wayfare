import { describe, expect, it, vi } from 'vitest';

const cached = vi.hoisted(() => ({ areas: undefined as undefined | { data: object[] } }));
vi.mock('@wayfare/api-client', () => ({ getAreasListQueryKey: () => ['areas'] }));
vi.mock('../state/query-client', () => ({ queryClient: { getQueryData: () => cached.areas } }));
vi.mock('../i18n', () => ({
  tourist: () => ({
    tFamily: (family: string, code: string, fallback: string) =>
      code === 'hcmc-d1' ? 'District 1' : `${family}:${fallback}`,
  }),
}));

const { areaName } = await import('./area-name');

describe('an area’s name, as every pack screen says it', () => {
  it('is the area’s name in the app’s language, from the cached areas', () => {
    cached.areas = { data: [{ id: 'a1', code: 'hcmc-d1' }] };
    expect(areaName('a1')).toBe('District 1');
  });

  it('falls back to the id’s start before the areas are read', () => {
    cached.areas = undefined;
    expect(areaName('0123456789abcdef')).toBe('area:01234567');
    cached.areas = { data: [] };
    expect(areaName('0123456789abcdef')).toBe('area:01234567');
  });
});
