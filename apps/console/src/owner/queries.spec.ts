// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, settle } from '../testing/render-hook';

const api = vi.hoisted(() => ({
  ownerPlacesList: vi.fn(() => Promise.resolve({ data: [{ id: 'p1' }] })),
  ownerPlacesLimits: vi.fn(() => Promise.resolve({ data: { maxPlaces: 3 } })),
  ownerSubmissionsList: vi.fn((_query: object) => Promise.resolve({ data: [{ id: 's1' }] })),
  ownerBillingOverview: vi.fn(() => Promise.resolve({ data: { plan: 'FREE' } })),
  ownerBillingPlans: vi.fn(() => Promise.resolve({ data: [{ code: 'GROWTH' }] })),
}));
vi.mock('@wayfare/api-client', () => api);

const {
  OWNER_KEYS,
  useBillingOverview,
  useLimits,
  useOwnerPlaces,
  usePendingSubmissions,
  usePlans,
} = await import('./queries');

const answer = async <T>(hook: () => { data: T }) => {
  const rendered = await renderHook(hook);
  await settle();
  return rendered.current().data;
};

describe('the owner’s own reads', () => {
  beforeEach(() => vi.clearAllMocks());

  it('read each list and answer its data', async () => {
    expect(await answer(() => useOwnerPlaces())).toEqual([{ id: 'p1' }]);
    expect(await answer(() => useLimits())).toEqual({ maxPlaces: 3 });
    expect(await answer(() => useBillingOverview())).toEqual({ plan: 'FREE' });
    expect(await answer(() => usePlans())).toEqual([{ code: 'GROWTH' }]);
  });

  it('reads the waiting submissions, a new venue’s name holding its place (K7)', async () => {
    expect(await answer(() => usePendingSubmissions())).toEqual([{ id: 's1' }]);
    expect(api.ownerSubmissionsList).toHaveBeenCalledWith({ status: 'PENDING', limit: 50 });
  });

  it('starts from the server’s rows when given, and asks nothing while turned off', async () => {
    const rendered = await renderHook(() => useOwnerPlaces([{ id: 'served' }] as never, false));
    expect(rendered.current().data).toEqual([{ id: 'served' }]);
    await renderHook(() => useLimits(false));
    await renderHook(() => useBillingOverview(false));
    await renderHook(() => usePlans(false));
    await settle();
    expect(api.ownerPlacesList).not.toHaveBeenCalled();
    expect(api.ownerPlacesLimits).not.toHaveBeenCalled();
    expect(api.ownerBillingOverview).not.toHaveBeenCalled();
    expect(api.ownerBillingPlans).not.toHaveBeenCalled();
  });

  it('keys a venue’s page by its id', () => {
    expect(OWNER_KEYS.place('p1')).toEqual(['owner-place', 'p1']);
  });
});
