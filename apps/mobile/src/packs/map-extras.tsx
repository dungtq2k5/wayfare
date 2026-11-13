import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { CloudOff } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useTourist } from '../i18n/use-tourist';
import { useAppStore } from '../state/app-store';
import { InlineNote } from '../ui/inline-note';
import { areaName } from './area-name';
import { packKey, usePackStore } from './controller';
import { USED_STATES } from './db';
import { openDownloadSheet } from './download-sheet';
import { networkKind } from './engine-deps';
import { DownloadPill, OfferCard, PackStateLine } from './pack-ui';
import { shouldOffer } from './offer';
import { usePackSettings } from './settings';
import { usePackCounts, usePackPlan } from './use-pack-plan';

/**
 * Under the area switcher on the Map: the *Download pill* while the area's download is not ready
 * (frame D2b); otherwise, once per area and on Wi-Fi, the offer (frame O1, K20), which waits for
 * the language switch's pill to leave.
 */
export function MapPackExtras({ areaId }: { areaId: string }) {
  const lang = useAppStore((state) => state.language) ?? 'en';
  const switching = useAppStore((state) => state.pendingLanguage !== null);
  const allPacks = usePackStore((state) => state.packs);
  const packs = allPacks.filter((pack) => pack.areaId === areaId);
  const mine = packs.find((pack) => pack.lang === lang) ?? null;
  const progress = usePackStore((state) => state.progress[packKey(areaId, lang)]);
  const offered = usePackSettings((state) => state.offered.includes(areaId));
  const wifi = useQuery({ queryKey: ['pack-network'], queryFn: networkKind, staleTime: 0 });
  const offering = shouldOffer({
    packsInArea: packs.length,
    offered,
    switching,
    network: wifi.data,
  });
  const plan = usePackPlan(offering ? areaId : null, lang);
  const counts = usePackCounts(areaId);

  if (mine !== null && !USED_STATES.includes(mine.state)) {
    return (
      <DownloadPill
        pack={mine}
        progress={progress}
        area={areaName(areaId)}
        onPress={() => router.push({ pathname: '/settings/pack', params: { areaId, lang } })}
      />
    );
  }
  if (!offering || plan.data === undefined) return null;
  const retire = () =>
    usePackSettings.setState((state) => ({ offered: [...state.offered, areaId] }));
  return (
    <OfferCard
      area={areaName(areaId)}
      size={plan.data.needed}
      places={counts.places}
      onNotNow={retire}
      onDownload={() => {
        retire();
        openDownloadSheet(areaId, lang);
      }}
    />
  );
}

/** Offline with no pack for the area (frame O2): the note says what is missing, and leads on. */
export function OfflineMapNote() {
  const { t } = useTourist();
  return (
    <InlineNote
      icon={CloudOff}
      text={t('pack.offlineNote')}
      action={{ label: t('pack.downloads'), onPress: () => router.push('/settings/downloads') }}
    />
  );
}

/** An area row's pack state in the area switcher (frame O3); *Download* opens the sheet. */
export function AreaPackState({ areaId }: { areaId: string }) {
  const lang = useAppStore((state) => state.language) ?? 'en';
  const pack = usePackStore(
    (state) => state.packs.find((p) => p.areaId === areaId && p.lang === lang) ?? null,
  );
  const progress = usePackStore((state) => state.progress[packKey(areaId, lang)]);
  const plan = usePackPlan(pack === null ? areaId : null, lang);
  const line = (
    <PackStateLine pack={pack} progress={progress} downloadSize={plan.data?.needed ?? null} />
  );
  if (pack !== null) return line;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => openDownloadSheet(areaId, lang)}
      className="min-h-target justify-center"
    >
      <View>{line}</View>
    </Pressable>
  );
}
