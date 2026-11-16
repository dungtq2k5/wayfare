'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { favoritesAdd, favoritesRemove, placesGet } from '@wayfare/api-client';
import { toast } from '@wayfare/ui/toaster';
import { useCallback, useState } from 'react';
import { useWeb } from '../i18n/provider';

export const favouriteKey = (placeId: string) => ['favourite', placeId] as const;
export const FAVOURITES_KEY = ['favourites'] as const;

/** How long unsaving can be undone (the handoff's §2: only unsaving has Undo). */
export const UNDO_MS = 5_000;

/**
 * A Place's heart (WQ1): read again with the browser's device after the server's device-less
 * render, saved on this browser — an account offered after (K9) — and unsaved with Undo.
 */
export function useFavourite(placeId: string, onSaved?: () => void) {
  const { t, locale } = useWeb();
  const queries = useQueryClient();
  const saved = useQuery({
    queryKey: favouriteKey(placeId),
    queryFn: async () => (await placesGet(placeId, { lang: locale })).data.isFavorite,
    staleTime: 30_000,
  });
  const [busy, setBusy] = useState(false);
  // Until this browser's read answers, the server's render may be wrong for a signed-in account:
  // a tap then would unsave a saved Place. A failed read (offline) lets the tap try, and say why.
  const known = saved.data !== undefined || saved.isError;
  const set = useCallback(
    (value: boolean) => queries.setQueryData(favouriteKey(placeId), value),
    [queries, placeId],
  );
  const toggle = useCallback(async () => {
    if (busy || !known) return;
    const was = saved.data === true;
    setBusy(true);
    set(!was);
    try {
      if (was) {
        await favoritesRemove(placeId);
        toast(t('fav.removed'), {
          duration: UNDO_MS,
          action: {
            label: t('fav.undo'),
            onClick: () => {
              set(true);
              void favoritesAdd(placeId).then(() =>
                queries.invalidateQueries({ queryKey: FAVOURITES_KEY }),
              );
            },
          },
        });
      } else {
        await favoritesAdd(placeId);
        onSaved?.();
      }
      void queries.invalidateQueries({ queryKey: FAVOURITES_KEY });
    } catch {
      set(was);
      toast.error(navigator.onLine ? t('error.generic') : t('place.saveOffline'));
    } finally {
      setBusy(false);
    }
  }, [busy, known, saved.data, set, placeId, t, queries, onSaved]);
  return { saved: saved.data === true, known, toggle, busy };
}
