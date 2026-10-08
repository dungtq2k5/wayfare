import { useQueryClient } from '@tanstack/react-query';
import {
  favoritesAdd,
  favoritesRemove,
  getFavoritesListQueryKey,
  useFavoritesList,
} from '@wayfare/api-client';
import { useMutation } from '@tanstack/react-query';
import { useTourist } from '../i18n/use-tourist';
import { useNetworkStore } from '../network/network-store';
import { useAppStore } from '../state/app-store';
import { showToast } from '../ui/toast';

/** The saved Places, online: favourites live on the server and are never queued offline. */
export function useFavourites() {
  const lang = useAppStore((state) => state.language) ?? 'en';
  const offline = useNetworkStore((state) => state.status === 'offline');
  const list = useFavoritesList({ lang, limit: 50 }, { query: { enabled: !offline } });
  const items = list.data?.data ?? [];
  return { ...list, items, ids: new Set(items.map((item) => item.placeId)), offline };
}

/** Saving and removing, with the offline explanation and the Undo toast. */
export function useToggleFavourite() {
  const { t } = useTourist();
  const queryClient = useQueryClient();
  const offline = useNetworkStore((state) => state.status === 'offline');
  const lang = useAppStore((state) => state.language) ?? 'en';
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getFavoritesListQueryKey({ lang, limit: 50 }) });
  const add = useMutation({
    mutationFn: (placeId: string) => favoritesAdd(placeId),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (placeId: string) => favoritesRemove(placeId),
    onSettled: refresh,
  });
  return {
    saving: add.isPending || remove.isPending,
    offline,
    toggle: (placeId: string, saved: boolean) => {
      if (offline) {
        showToast(t('favorites.needsConnection'));
        return;
      }
      if (saved) {
        remove.mutate(placeId, {
          onSuccess: () =>
            showToast(t('favorites.removed'), {
              label: t('favorites.undo'),
              onPress: () => add.mutate(placeId),
            }),
        });
      } else {
        add.mutate(placeId);
      }
    },
  };
}
