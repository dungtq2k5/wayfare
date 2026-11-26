// @vitest-environment happy-dom
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { keyTourist, memoryKv } from '../testing/shell-fakes';
import { renderHook, settle } from '@wayfare/ui/testing';

vi.mock('expo-sqlite/kv-store', () => ({ default: memoryKv() }));
vi.mock('../i18n/use-tourist', () => ({ useTourist: () => keyTourist }));
const toasts = vi.hoisted(() => ({
  showToast: vi.fn<(message: string, action?: { label: string; onPress: () => void }) => void>(),
}));
vi.mock('../ui/toast', () => toasts);
const api = vi.hoisted(() => ({
  list: vi.fn<(params: object, options: { query: { enabled: boolean } }) => unknown>(),
  favoritesAdd: vi.fn(() => Promise.resolve({})),
  favoritesRemove: vi.fn(() => Promise.resolve({})),
}));
vi.mock('@wayfare/api-client', () => ({
  useFavoritesList: api.list,
  favoritesAdd: api.favoritesAdd,
  favoritesRemove: api.favoritesRemove,
  getFavoritesListQueryKey: (params: object) => ['favorites', params],
}));

const { useFavourites, useToggleFavourite } = await import('./use-favorites');
const { useNetworkStore } = await import('../network/network-store');
const { useAppStore } = await import('../state/app-store');

describe('the saved Places (online only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockReturnValue({ data: { data: [{ placeId: 'p1' }, { placeId: 'p2' }] } });
    useNetworkStore.setState({ status: 'online' });
    useAppStore.setState({ language: 'vi' });
  });

  it('lists them in the app’s language, with their ids', async () => {
    const rendered = await renderHook(() => useFavourites());
    expect(rendered.current().ids).toEqual(new Set(['p1', 'p2']));
    expect(api.list).toHaveBeenCalledWith({ lang: 'vi', limit: 50 }, { query: { enabled: true } });
  });

  it('lists them in English before a language is chosen', async () => {
    useAppStore.setState({ language: null });
    await renderHook(() => useFavourites());
    const toggle = await renderHook(() => useToggleFavourite());
    const invalidate = vi.spyOn(toggle.queries, 'invalidateQueries');
    act(() => toggle.current().toggle('p9', false));
    await settle();
    expect(api.list).toHaveBeenCalledWith({ lang: 'en', limit: 50 }, { query: { enabled: true } });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['favorites', { lang: 'en', limit: 50 }] });
  });

  it('asks nothing offline, and lists none until there is an answer', async () => {
    useNetworkStore.setState({ status: 'offline' });
    api.list.mockReturnValue({ data: undefined });
    const rendered = await renderHook(() => useFavourites());
    expect(rendered.current()).toMatchObject({ items: [], offline: true });
    expect(api.list.mock.calls.at(-1)![1]).toEqual({ query: { enabled: false } });
  });

  it('saves a Place, and reads the list again', async () => {
    const rendered = await renderHook(() => useToggleFavourite());
    const invalidate = vi.spyOn(rendered.queries, 'invalidateQueries');
    act(() => rendered.current().toggle('p3', false));
    await settle();
    expect(api.favoritesAdd).toHaveBeenCalledWith('p3');
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['favorites', { lang: 'vi', limit: 50 }],
    });
  });

  it('removes one with an Undo that saves it again', async () => {
    const rendered = await renderHook(() => useToggleFavourite());
    act(() => rendered.current().toggle('p1', true));
    await settle();
    expect(api.favoritesRemove).toHaveBeenCalledWith('p1');
    const [message, action] = toasts.showToast.mock.calls[0]!;
    expect(message).toBe('favorites.removed');
    expect(action!.label).toBe('favorites.undo');
    act(() => action!.onPress());
    await settle();
    expect(api.favoritesAdd).toHaveBeenCalledWith('p1');
  });

  it('offline, keeps the heart tappable and says it needs a connection', async () => {
    useNetworkStore.setState({ status: 'offline' });
    const rendered = await renderHook(() => useToggleFavourite());
    act(() => rendered.current().toggle('p1', true));
    expect(toasts.showToast).toHaveBeenCalledWith('favorites.needsConnection');
    expect(api.favoritesRemove).not.toHaveBeenCalled();
  });

  it('shows the saving state while a change is on its way', async () => {
    let finish: () => void = () => undefined;
    api.favoritesAdd.mockReturnValueOnce(new Promise((resolve) => (finish = () => resolve({}))));
    const rendered = await renderHook(() => useToggleFavourite());
    act(() => rendered.current().toggle('p4', false));
    await settle();
    expect(rendered.current().saving).toBe(true);
    finish();
    await settle();
    expect(rendered.current().saving).toBe(false);
  });
});
