import { CLIENT_HEADER, APP_VERSION_HEADER } from '@wayfare/contracts';
import { getPlacesGetQueryKey, placesByCode } from '@wayfare/api-client';
import type { Language } from '@wayfare/contracts';
import { router } from 'expo-router';
import { APP_VERSION } from '../api';
import { databaseReady } from '../data/boot';
import { placeByPublicCode } from '../data/queries';
import { API_URL } from '../env';
import { tourist } from '../i18n';
import { useNetworkStore } from '../network/network-store';
import { narrationPlayer } from '../player/narration-player';
import { usePlayerStore } from '../player/store';
import type { PlayerPlace } from '../player/types';
import { playerPlaceOf, viewFromDetail, viewFromRecord } from '../places/place-view';
import type { PlaceView } from '../places/place-view';
import { useAppStore } from '../state/app-store';
import { queryClient } from '../state/query-client';
import { showToast } from '../ui/toast';
import { createCodeOpener } from './open-code';
import type { ResolvedPlace } from './open-code';
import { useCodeStore } from './store';

const language = (): Language => useAppStore.getState().language ?? 'en';

const resolved = (view: PlaceView): ResolvedPlace<PlayerPlace> => ({
  id: view.id,
  areaId: view.areaId,
  location: view.location,
  player: playerPlaceOf(view),
});

/** A toast with an action stays long enough to reach for it. */
const ACTION_TOAST_MS = 8_000;

let openedSeq = 0;

/**
 * Brings the Map to the front: the screens over the tabs (the scanner, the typed code, a Place's
 * detail) close back down to it rather than a second Map being pushed over them.
 */
export function showMap(): void {
  if (router.canDismiss()) router.dismissTo('/map');
  else router.navigate('/map');
}

/**
 * Counts a sticker scan the app resolved itself (rdm-spec C-15): the gateway answers the app's
 * client header with `204`, so the redirect to the web page is never followed. `/q/` is not an API
 * route, so this is a plain request; nothing waits on it and a failure is not retried.
 */
function countScan(code: string): void {
  void fetch(`${new URL(API_URL).origin}/q/${code}`, {
    headers: { [CLIENT_HEADER]: 'mobile', [APP_VERSION_HEADER]: APP_VERSION },
  }).catch(() => undefined);
}

/** The app's one code opener: the scanner, the typed code and links all end here. */
export const codeOpener = createCodeOpener<PlayerPlace>({
  findLocal: async (code) => {
    const record = await placeByPublicCode(await databaseReady, code, language());
    return record === null ? null : resolved(viewFromRecord(record));
  },
  fetchByCode: async (code) => {
    const lang = language();
    const answer = await placesByCode(code, { lang });
    // The sheet reads the same Place by id: it finds it here instead of asking again.
    queryClient.setQueryData(getPlacesGetQueryKey(answer.data.id, { lang }), answer);
    return resolved(viewFromDetail(answer.data));
  },
  online: () => useNetworkStore.getState().status !== 'offline',
  playingId: () => usePlayerStore.getState().current?.place.id ?? null,
  play: (place) => narrationPlayer.play(place),
  alreadyPlaying: () => {
    const { t } = tourist();
    showToast(
      t('code.alreadyPlaying'),
      {
        label: t('code.startOver'),
        onPress: () => narrationPlayer.replay(),
      },
      ACTION_TOAST_MS,
    );
  },
  reveal: (place) => {
    openedSeq += 1;
    useCodeStore.setState({
      opened: { seq: openedSeq, placeId: place.id, areaId: place.areaId, location: place.location },
    });
    showMap();
  },
  show: (result) => useCodeStore.setState({ result }),
  count: countScan,
});
