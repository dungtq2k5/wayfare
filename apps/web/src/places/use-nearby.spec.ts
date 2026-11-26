// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, settle } from '@wayfare/ui/testing';

vi.mock('../i18n/provider', () => ({ useWeb: () => ({ locale: 'en' }) }));
const api = vi.hoisted(() => ({
  placesNearby: vi.fn((_params: Record<string, unknown>) => Promise.resolve({ data: [] })),
}));
vi.mock('@wayfare/api-client', () => api);

const { useNearby } = await import('./use-nearby');

describe('the list near a point (K5)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks nothing before there is a point', async () => {
    await renderHook(() => useNearby(null, 500));
    await settle();
    expect(api.placesNearby).not.toHaveBeenCalled();
  });

  it('rounds the point and the radius, so a nudged map asks nothing new', async () => {
    await renderHook(() => useNearby({ lat: 10.77612, lng: 106.70089 }, 1_234, 'CAFE'));
    await settle();
    expect(api.placesNearby).toHaveBeenCalledWith({
      lat: 10.776,
      lng: 106.701,
      radiusM: 1_200,
      lang: 'en',
      limit: 50,
      categoryCode: 'CAFE',
    });
  });

  it('keeps the radius between 100 m and 5 km, and asks every category when none is chosen', async () => {
    await renderHook(() => useNearby({ lat: 10, lng: 106 }, 20, null));
    await renderHook(() => useNearby({ lat: 11, lng: 107 }, 90_000));
    await settle();
    const asked = api.placesNearby.mock.calls.map(([params]) => params);
    expect(asked.map((params) => params.radiusM)).toEqual([100, 5_000]);
    expect(asked.every((params) => !('categoryCode' in params))).toBe(true);
  });
});
