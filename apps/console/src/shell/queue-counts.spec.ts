// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, settle } from '@wayfare/ui/testing';

const me = vi.hoisted(() => ({ permissions: [] as string[] }));
vi.mock('./me', () => ({ useMe: () => me }));
const api = vi.hoisted(() => ({
  adminSubmissionsList: vi.fn((_query: object) => Promise.resolve({ meta: { total: 7 } })),
  adminOwnerRegistrationsList: vi.fn((_query: object) => Promise.resolve({ meta: { total: 2 } })),
}));
vi.mock('@wayfare/api-client', () => api);

const { useQueueCounts } = await import('./queue-counts');
const { useCan } = await import('./can');

const counts = async () => {
  const rendered = await renderHook(() => useQueueCounts());
  await settle();
  return rendered.current();
};

describe('the waiting counts beside the queues (K9)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads each queue’s total with one row, for whoever may read it', async () => {
    me.permissions = ['submission.read', 'owner_registration.read'];
    expect(await counts()).toEqual({ submissions: 7, registrations: 2 });
    expect(api.adminSubmissionsList).toHaveBeenCalledWith({ status: 'PENDING', pageSize: 1 });
    expect(api.adminOwnerRegistrationsList).toHaveBeenCalledWith({
      status: 'PENDING',
      pageSize: 1,
    });
  });

  it('asks nothing, and shows no count, for a queue the person can’t read', async () => {
    me.permissions = ['submission.read'];
    expect(await counts()).toEqual({ submissions: 7 });
    expect(api.adminOwnerRegistrationsList).not.toHaveBeenCalled();
  });

  it('drops a count whose read failed: the link still works', async () => {
    me.permissions = ['submission.read'];
    api.adminSubmissionsList.mockRejectedValueOnce(new Error('down'));
    expect(await counts()).toEqual({});
  });
});

describe('an action for its holder only (K2)', () => {
  it('says whether the signed-in person holds a permission', async () => {
    me.permissions = ['place.update'];
    const can = (await renderHook(() => useCan())).current();
    expect(can('place.update')).toBe(true);
    expect(can('place.delete')).toBe(false);
  });
});
