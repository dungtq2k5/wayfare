// @vitest-environment happy-dom
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTranslator, ENGLISH } from '../i18n/messages';
import { renderHook, settle } from '../testing/render-hook';

vi.mock('../i18n/provider', () => ({ useWeb: () => createTranslator('en', ENGLISH) }));
const api = vi.hoisted(() => ({
  placesGet: vi.fn(),
  favoritesAdd: vi.fn(() => Promise.resolve({})),
  favoritesRemove: vi.fn(() => Promise.resolve({})),
}));
vi.mock('@wayfare/api-client', () => api);
const toasts = vi.hoisted(() => {
  const toast = Object.assign(
    vi.fn<
      (
        text: string,
        options: { duration: number; action: { label: string; onClick: () => void } },
      ) => void
    >(),
    { error: vi.fn() },
  );
  return { toast };
});
vi.mock('@wayfare/ui/toaster', () => toasts);

const { FAVOURITES_KEY, UNDO_MS, useFavourite } = await import('./use-favourite');

const browser = { onLine: true };
const saved = (value: boolean) => api.placesGet.mockResolvedValue({ data: { isFavorite: value } });

async function heart(onSaved?: () => void) {
  const rendered = await renderHook(() => useFavourite('p1', onSaved));
  await settle();
  return rendered;
}

describe('a Place’s heart (WQ1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browser.onLine = true;
    vi.stubGlobal('navigator', browser);
  });

  it('reads this browser’s answer before a tap can change anything', async () => {
    let answer: (value: unknown) => void = () => undefined;
    api.placesGet.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const rendered = await renderHook(() => useFavourite('p1'));
    expect(rendered.current().known).toBe(false);
    await act(() => rendered.current().toggle());
    expect(api.favoritesAdd).not.toHaveBeenCalled();
    answer({ data: { isFavorite: true } });
    await settle();
    expect(rendered.current()).toMatchObject({ known: true, saved: true });
  });

  it('saves at once, then offers an account', async () => {
    saved(false);
    const onSaved = vi.fn();
    const rendered = await heart(onSaved);
    const invalidate = vi.spyOn(rendered.queries, 'invalidateQueries');
    await act(() => rendered.current().toggle());
    expect(api.favoritesAdd).toHaveBeenCalledWith('p1');
    expect(onSaved).toHaveBeenCalled();
    expect(rendered.current().saved).toBe(true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: FAVOURITES_KEY });
  });

  it('unsaves with an Undo that saves it again', async () => {
    saved(true);
    const rendered = await heart();
    await act(() => rendered.current().toggle());
    expect(api.favoritesRemove).toHaveBeenCalledWith('p1');
    expect(rendered.current().saved).toBe(false);
    const [text, options] = toasts.toast.mock.calls[0]!;
    expect(text).toBe(ENGLISH['fav.removed']);
    expect(options.duration).toBe(UNDO_MS);
    expect(options.action.label).toBe(ENGLISH['fav.undo']);
    // The server now says unsaved: the heart comes back by Undo alone.
    saved(false);
    act(() => options.action.onClick());
    await settle();
    expect(api.favoritesAdd).toHaveBeenCalledWith('p1');
    expect(rendered.current().saved).toBe(true);
  });

  it('puts the heart back when saving fails, saying why — offline, or otherwise', async () => {
    saved(false);
    api.favoritesAdd.mockRejectedValueOnce(new Error('down'));
    const rendered = await heart();
    await act(() => rendered.current().toggle());
    expect(rendered.current()).toMatchObject({ saved: false, busy: false });
    expect(toasts.toast.error).toHaveBeenLastCalledWith(ENGLISH['error.generic']);
    browser.onLine = false;
    api.favoritesAdd.mockRejectedValueOnce(new Error('offline'));
    await act(() => rendered.current().toggle());
    expect(toasts.toast.error).toHaveBeenLastCalledWith(ENGLISH['place.saveOffline']);
  });

  it('lets a tap try when this browser’s read failed', async () => {
    api.placesGet.mockRejectedValue(new Error('offline'));
    const rendered = await heart();
    expect(rendered.current()).toMatchObject({ known: true, saved: false });
    await act(() => rendered.current().toggle());
    expect(api.favoritesAdd).toHaveBeenCalled();
  });
});
