import { devicesUpdate, getAreasListQueryKey, narrationHotset } from '@wayfare/api-client';
import type { AreasList200 } from '@wayfare/api-client';
import type { Language } from '@wayfare/contracts';
import { CircleCheck } from 'lucide-react-native';
import { useEffect } from 'react';
import { databaseReady } from '../data/boot';
import { areaSummaries, placeById } from '../data/queries';
import { useLocationStore } from '../location/location-store';
import { checkNetwork } from '../network/network-store';
import { playerPlaceOf, viewFromRecord } from '../places/place-view';
import { narrationPlayer } from '../player/narration-player';
import { useAppStore } from '../state/app-store';
import { queryClient } from '../state/query-client';
import { runSync } from '../sync/run-sync';
import { showToast } from '../ui/toast';
import i18next, { isBundled, loadUi, NAMESPACE, showLanguage, uiFromPhone } from '../i18n';
import { LANGUAGE_NAMES } from '../i18n/languages';
import { startLanguageSwitch, useSwitchStore } from './switch';
import type { SwitchDeps } from './switch';
import { useSwitchHolds } from '../i18n/switch-holds';

/** Where the hotset is asked from: the last known position, else the Map's area centre. */
function hotsetOrigin(): { lat: number; lng: number } | null {
  const position = useLocationStore.getState().position;
  if (position !== null) return { lat: position.lat, lng: position.lng };
  const areas = queryClient.getQueryData<AreasList200>(getAreasListQueryKey())?.data ?? [];
  const { currentAreaId } = useAppStore.getState();
  const area = areas.find((candidate) => candidate.id === currentAreaId) ?? areas[0];
  return area === undefined ? null : area.center;
}

/** "Switched to 日本語", said in the language just reached (its first string on screen). */
function toastDone(lang: string): void {
  const t = i18next.getFixedT(lang, NAMESPACE);
  showToast(t('switch.done', { lang: LANGUAGE_NAMES[lang as Language] }), undefined, 4_000, {
    icon: CircleCheck,
  });
}

const deps: SwitchDeps = {
  now: Date.now,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  online: async () => (await checkNetwork()) === 'online',
  bundled: isBundled,
  uiFromPhone,
  loadUi,
  async syncedLike(lang, current) {
    const db = await databaseReady;
    const [now, other] = await Promise.all([areaSummaries(db, current), areaSummaries(db, lang)]);
    const synced = new Set(other.map((area) => area.areaId));
    return now.length > 0 && now.every((area) => synced.has(area.areaId));
  },
  sync: (lang) => runSync(lang),
  async hotset(lang) {
    const origin = hotsetOrigin();
    // Nowhere to ask from: nothing near to wait for.
    if (origin === null) return { ready: 0, required: 0 };
    const { data } = await narrationHotset({ ...origin, lang });
    // Fewer Places near than the hotset asks for: all of them is enough.
    const near = data.ready.length + data.pending.length;
    return { ready: data.ready.length, required: Math.min(data.requiredReadyCount, near) };
  },
  registered: () =>
    new Promise<void>((resolve) => {
      if (useAppStore.getState().onboarded) return resolve();
      const unsubscribe = useAppStore.subscribe((state) => {
        if (!state.onboarded) return;
        unsubscribe();
        resolve();
      });
    }),
  completed(lang, { toast }) {
    // Not awaited: a failure is sent again at the next launch's switch, as Settings did.
    void devicesUpdate({ contentLocale: lang }).catch(() => undefined);
    if (toast) toastDone(lang);
    void narrationPlayer.relanguage(async (placeId) => {
      const record = await placeById(await databaseReady, placeId, lang);
      return record === null ? null : playerPlaceOf(viewFromRecord(record));
    });
  },
  holds: () => useSwitchHolds.getState(),
  clearFailNext: () => useSwitchHolds.setState({ failNext: false }),
};

/** A long tail's words landed after its switch (T2): the screens redraw, and say so. */
function landed(language: string): void {
  if (useSwitchStore.getState().screensPending !== language) return;
  useSwitchStore.setState({ screensPending: null });
  toastDone(language);
}

/**
 * Mount once, in the root layout: shows the store's language, and runs a switch — resuming one an
 * earlier launch left under way.
 */
export function useLanguageSwitch(): void {
  const hydrated = useAppStore((state) => state.hydrated);
  const language = useAppStore((state) => state.language);
  useEffect(() => {
    if (language !== null) void showLanguage(language, landed);
  }, [language]);
  useEffect(() => {
    if (hydrated) startLanguageSwitch(deps);
  }, [hydrated]);
}
