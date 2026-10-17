import { useQuery } from '@tanstack/react-query';
import type { Language } from '@wayfare/contracts';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { Download, RefreshCw, Trash2, TriangleAlert } from 'lucide-react-native';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { databaseReady } from '../../src/data/boot';
import { LANGUAGE_NAMES } from '../../src/i18n/languages';
import { useTourist } from '../../src/i18n/use-tourist';
import { areaName } from '../../src/packs/area-name';
import {
  allowMobileData,
  applyUpdate,
  cancelDownload,
  packKey,
  pausePack,
  removePack,
  resumePack,
  runPack,
  usePackStore,
} from '../../src/packs/controller';
import { damageOf } from '../../src/packs/damage';
import { filesOfPack, setPackState, USED_STATES } from '../../src/packs/db';
import { openDownloadSheet } from '../../src/packs/download-sheet';
import { formatSize, shortDate } from '../../src/packs/format';
import { FilledButton, PackStateLine, PartsList, ProgressCard } from '../../src/packs/pack-ui';
import { packAudioUri } from '../../src/packs/use-pack-files';
import { useHeldPlan, usePackCounts, usePackPlan } from '../../src/packs/use-pack-plan';
import { narrationPlayer } from '../../src/player/narration-player';
import { usePlayerStore } from '../../src/player/store';
import { useAppStore } from '../../src/state/app-store';
import { Icon } from '../../src/theme/icon';
import { Button } from '../../src/ui/button';
import { LIST_END_PADDING } from '../../src/ui/layout';
import { ScreenHeader } from '../../src/ui/screen-header';
import { showToast } from '../../src/ui/toast';

function Card({
  icon,
  title,
  body,
  action,
}: {
  icon: typeof RefreshCw;
  title: string;
  body: string;
  action: { label: string; onPress: () => void; testID?: string };
}) {
  return (
    <View className="gap-3 rounded-xl border border-border bg-card p-4 elevation-1">
      <View className="flex-row gap-3">
        <Icon icon={icon} size="lg" color="primary" />
        <View className="flex-1 gap-1">
          <Text accessibilityRole="header" className="text-body-strong text-foreground">
            {title}
          </Text>
          <Text className="text-label text-muted-foreground">{body}</Text>
        </View>
      </View>
      <View className="items-end">
        <FilledButton label={action.label} onPress={action.onPress} testID={action.testID} />
      </View>
    </View>
  );
}

/**
 * A pack (frame M2): its state, language, size and dates, the download's progress while it runs,
 * an update (frame M3), a repair (frame M4), the app's language offered (frame M6), what is in it,
 * and *Delete this download* (frame M5).
 */
export default function PackScreen() {
  const { t } = useTourist();
  const params = useLocalSearchParams<{ areaId: string; lang: string }>();
  const areaId = params.areaId;
  const lang = params.lang;
  const appLanguage = useAppStore((state) => state.language) ?? 'en';
  const pack = usePackStore(
    (state) => state.packs.find((p) => p.areaId === areaId && p.lang === lang) ?? null,
  );
  const hasAppLanguage = usePackStore((state) =>
    state.packs.some((p) => p.areaId === areaId && p.lang === appLanguage),
  );
  const progress = usePackStore((state) => state.progress[packKey(areaId, lang)]);
  const held = useHeldPlan(areaId, lang);
  const counts = usePackCounts(areaId);
  const other = usePackPlan(hasAppLanguage || appLanguage === lang ? null : areaId, appLanguage);
  const damage = useQuery({
    queryKey: ['pack-damage', areaId, lang, pack?.state],
    enabled: pack?.state === 'damaged',
    queryFn: async () => damageOf(await filesOfPack(await databaseReady, areaId, lang)),
  });
  const area = areaName(areaId);
  const language = LANGUAGE_NAMES[lang as Language] ?? lang;
  // Back from *Free up space* (frame D7b): a download stopped for space tries again; it stops
  // again at once if there is still no room.
  const state = pack?.state;
  useFocusEffect(
    useCallback(() => {
      if (state === 'no-space') void runPack(areaId, lang);
    }, [state, areaId, lang]),
  );

  if (pack === null) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <ScreenHeader title={area} type="back" />
      </SafeAreaView>
    );
  }

  const used = USED_STATES.includes(pack.state);
  const meta = [
    language,
    formatSize(pack.bytes),
    ...(pack.installedAt === null
      ? []
      : [t('pack.screen.installed', { date: shortDate(pack.installedAt, appLanguage) })]),
    ...(pack.updatedAt === null || pack.updatedAt === pack.installedAt
      ? []
      : [t('pack.screen.updated', { date: shortDate(pack.updatedAt, appLanguage) })]),
  ].join(' · ');

  const confirmDelete = () => {
    const current = usePlayerStore.getState().current;
    // A story playing from this pack's file stops with it.
    const playing =
      current !== null &&
      current.place.areaId === areaId &&
      current.source === 'file' &&
      current.place.audio !== null &&
      packAudioUri(current.place.audio.sha256) !== null;
    const body = [
      t('pack.delete.body', { size: formatSize(pack.bytes) }),
      ...(playing ? [t('pack.delete.playing')] : []),
    ].join(' ');
    Alert.alert(t('pack.delete.title', { area }), body, [
      { text: t('pack.delete.cancel'), style: 'cancel' },
      {
        text: t('pack.delete.confirm'),
        style: 'destructive',
        onPress: () =>
          void (async () => {
            if (playing) narrationPlayer.stop();
            const freed = await removePack(areaId, lang);
            showToast(t('pack.toast.deleted', { area, size: formatSize(freed || pack.bytes) }));
            router.back();
          })(),
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title={area} type="back" />
      <ScrollView contentContainerStyle={{ paddingBottom: LIST_END_PADDING }}>
        <View className="gap-4 px-4">
          <View className="gap-1">
            <PackStateLine pack={pack} progress={progress} />
            <Text className="text-label text-muted-foreground">{meta}</Text>
          </View>

          {!used && (
            <ProgressCard
              pack={pack}
              progress={progress}
              actions={{
                pause: () => void pausePack(areaId, lang),
                resume: () => void resumePack(areaId, lang),
                cancel: () => {
                  router.back();
                  void cancelDownload(areaId, lang);
                },
                useMobileData: () => void allowMobileData(areaId, lang),
                tryAgain: () => void resumePack(areaId, lang),
                freeUp: () => router.push('/settings/downloads'),
              }}
            />
          )}

          {pack.state === 'update' && pack.update !== null && (
            <Card
              icon={RefreshCw}
              title={t('pack.update.title', { size: formatSize(pack.update.bytes) })}
              body={t('pack.update.body', {
                changed: pack.update.changed,
                added: pack.update.added,
                date: shortDate(pack.update.since || pack.installedAt, appLanguage),
              })}
              action={{
                label: t('pack.update.button', { size: formatSize(pack.update.bytes) }),
                testID: 'pack-update',
                onPress: () => void applyUpdate(areaId, lang),
              }}
            />
          )}

          {pack.state === 'damaged' && damage.data !== undefined && (
            <Card
              icon={TriangleAlert}
              title={t('pack.damaged.title')}
              body={t('pack.damaged.body', { count: damage.data.stories })}
              action={{
                label: t('pack.damaged.repair', { size: formatSize(damage.data.bytes) }),
                testID: 'pack-repair',
                onPress: () =>
                  void (async () => {
                    await setPackState(await databaseReady, areaId, lang, 'downloading');
                    void runPack(areaId, lang);
                  })(),
              }}
            />
          )}

          {other.data !== undefined && (
            <Card
              icon={Download}
              title={t('pack.other.title', { language: LANGUAGE_NAMES[appLanguage] })}
              body={t('pack.other.body', {
                language: LANGUAGE_NAMES[appLanguage],
                size: formatSize(other.data.needed),
              })}
              action={{
                label: t('pack.other.button', { size: formatSize(other.data.needed) }),
                onPress: () => openDownloadSheet(areaId, appLanguage),
              }}
            />
          )}

          {held.data !== undefined && (
            <View className="gap-2">
              <Text accessibilityRole="header" className="px-2 text-label text-muted-foreground">
                {t('pack.screen.contents')}
              </Text>
              <View className="rounded-xl bg-card px-4 py-2">
                <PartsList
                  plan={held.data}
                  counts={counts}
                  sizeOf={(kind) => held.data.parts[kind].total}
                  listeningLabel={(time) => t('pack.screen.listening', { time })}
                />
              </View>
            </View>
          )}

          {used && (
            <Button
              label={t('pack.screen.delete')}
              icon={Trash2}
              variant="destructive"
              onPress={confirmDelete}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
