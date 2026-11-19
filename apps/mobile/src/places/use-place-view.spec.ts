// @vitest-environment happy-dom
import { ApiError } from '@wayfare/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryKv } from '../testing/shell-fakes';
import { renderHook } from '../testing/render-hook';

vi.mock('expo-sqlite/kv-store', () => ({ default: memoryKv() }));
interface Answer {
  data?: unknown;
  error?: unknown;
  isError?: boolean;
  isPending?: boolean;
  refetch?: () => void;
}
const reads = vi.hoisted(() => {
  const online: Answer = {};
  const local: Answer = {};
  return {
    online,
    local,
    asked: vi.fn<(id: string, params: object, options: { query: { enabled: boolean } }) => void>(),
  };
});
vi.mock('@wayfare/api-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePlacesGet: (id: string, params: object, options: { query: { enabled: boolean } }) => {
    reads.asked(id, params, options);
    return reads.online;
  },
}));
vi.mock('../data/hooks', () => ({ useLocalPlace: () => reads.local }));
vi.mock('./place-view', () => ({
  viewFromDetail: (detail: unknown) => ({ from: 'gateway', detail }),
  viewFromRecord: (record: unknown) => ({ from: 'phone', record }),
}));

const { usePlaceView } = await import('./use-place-view');
const { useNetworkStore } = await import('../network/network-store');

const view = async () => (await renderHook(() => usePlaceView('p1'))).current();

describe('a Place’s detail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNetworkStore.setState({ status: 'online' });
    reads.online = { isPending: true };
    reads.local = { isPending: true };
  });

  it('is the gateway’s online, in the app’s language', async () => {
    reads.online = { data: { data: 'detail' } };
    expect(await view()).toEqual({ kind: 'ready', view: { from: 'gateway', detail: 'detail' } });
    expect(reads.asked).toHaveBeenCalledWith(
      'p1',
      { lang: 'en' },
      { query: { enabled: true, retry: false } },
    );
  });

  it('says a Place gone from Wayfare is removed', async () => {
    reads.online = { error: new ApiError(410, 'PLACE_UNAVAILABLE', 'x'), isError: true };
    expect(await view()).toEqual({ kind: 'removed' });
    reads.online = { error: new ApiError(404, 'RESOURCE_NOT_FOUND', 'x'), isError: true };
    expect(await view()).toEqual({ kind: 'removed' });
  });

  it('is the phone’s synced record offline, or when the gateway doesn’t answer', async () => {
    useNetworkStore.setState({ status: 'offline' });
    reads.online = { data: { data: 'stale' } };
    reads.local = { data: 'record' };
    expect(await view()).toEqual({ kind: 'ready', view: { from: 'phone', record: 'record' } });
    expect(reads.asked.mock.calls[0]![2].query.enabled).toBe(false);
    useNetworkStore.setState({ status: 'online' });
    reads.online = { error: new Error('timeout'), isError: true };
    expect((await view()).kind).toBe('ready');
  });

  it('waits while the phone reads its record, and offers a retry when it holds none', async () => {
    reads.online = { error: new Error('timeout'), isError: true, refetch: vi.fn() };
    expect(await view()).toEqual({ kind: 'loading' });
    reads.local = { isPending: false };
    const failed = await view();
    expect(failed.kind).toBe('error');
    if (failed.kind === 'error') failed.retry();
    expect(reads.online.refetch).toHaveBeenCalled();
  });

  it('is loading while the gateway answers', async () => {
    expect(await view()).toEqual({ kind: 'loading' });
  });
});
