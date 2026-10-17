import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Download, Globe, Smartphone, TriangleAlert } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { create } from 'zustand';
import { errorMessage } from '../i18n';
import { LANGUAGE_NAMES } from '../i18n/languages';
import { useTourist } from '../i18n/use-tourist';
import { Icon } from '../theme/icon';
import { showToast } from '../ui/toast';
import type { Language } from '@wayfare/contracts';
import { areaName } from './area-name';
import { startDownload } from './controller';
import { SPACE_MARGIN } from './engine';
import { clearOwnCaches, freeBytes, networkKind } from './engine-deps';
import { formatSize } from './format';
import { FilledButton, PartsList, TextButton } from './pack-ui';
import { usePackCounts, usePackPlan } from './use-pack-plan';

interface SheetState {
  open: { areaId: string; lang: string } | null;
}

const useDownloadSheet = create<SheetState>(() => ({ open: null }));

/** Opens the sheet before a download (frame D1) for the area in `lang`. */
export const openDownloadSheet = (areaId: string, lang: string) =>
  useDownloadSheet.setState({ open: { areaId, lang } });
const close = () => useDownloadSheet.setState({ open: null });

/**
 * Before downloading: the area and the pack's language, the size by part, the total, the free space
 * after, and the network (frames D1, D1b, D7). Short of space, Wayfare's own caches are cleared
 * first, without asking (K7); mobile data is named before anything downloads, *Wait for Wi-Fi* first.
 */
function Sheet({ areaId, lang }: { areaId: string; lang: string }) {
  const { t } = useTourist();
  const plan = usePackPlan(areaId, lang);
  const counts = usePackCounts(areaId);
  const network = useQuery({ queryKey: ['pack-network'], queryFn: networkKind, staleTime: 0 });
  const [free, setFree] = useState(freeBytes);
  const data = plan.data;
  const needed = data?.needed ?? 0;
  const short = data !== undefined && free < needed * SPACE_MARGIN;

  // Short of space: the caches go first, then the space is read again.
  useEffect(() => {
    if (!short) return;
    void (async () => {
      await clearOwnCaches().catch(() => undefined);
      setFree(freeBytes());
    })();
  }, [short]);

  const area = areaName(areaId);
  const mobile = network.data === 'cellular';
  const start = (wifiOnly: boolean) => {
    close();
    router.push({ pathname: '/settings/pack', params: { areaId, lang } });
    // A download that cannot start (the manifest unreachable) says why, in the app's words.
    startDownload(areaId, lang, wifiOnly).catch((error: unknown) => {
      console.warn('Download did not start', error);
      showToast(errorMessage(error));
    });
  };

  return (
    <View className="max-h-full gap-3 rounded-t-2xl bg-card p-4 elevation-3">
      <View className="h-1 w-10 self-center rounded-full bg-muted" />
      <Text accessibilityRole="header" className="text-title text-foreground">
        {t('pack.sheet.title', { area })}
      </Text>
      <ScrollView contentContainerClassName="gap-3">
        <Text className="text-body text-muted-foreground">
          {t('pack.sheet.body', { language: LANGUAGE_NAMES[lang as Language] ?? lang })}
        </Text>
        {data === undefined ? (
          <Text className="text-body text-muted-foreground">…</Text>
        ) : (
          <>
            <PartsList
              plan={data}
              counts={counts}
              sizeOf={(kind) => data.parts[kind].needed}
              listeningLabel={(time) => time}
            />
            <View className="flex-row items-center justify-between">
              <Text className="text-body-strong text-foreground">{t('pack.sheet.total')}</Text>
              <Text className="text-body-strong text-foreground">{formatSize(needed)}</Text>
            </View>
            <View className="flex-row items-center gap-2">
              <Icon icon={Smartphone} size="sm" color="muted-foreground" />
              <Text className="text-label text-muted-foreground">
                {t('pack.sheet.freeAfter', { size: formatSize(Math.max(free - needed, 0)) })}
              </Text>
            </View>
            <View className="flex-row items-center gap-2">
              <Icon icon={Globe} size="sm" color="muted-foreground" />
              <Text className="text-label text-muted-foreground">
                {mobile ? t('pack.sheet.onMobile') : t('pack.sheet.onWifi')}
              </Text>
            </View>
            {(short || mobile) && (
              <View className="flex-row gap-2 rounded-lg bg-warning p-3">
                <Icon icon={TriangleAlert} size="md" color="warning-foreground" />
                <Text className="flex-1 text-label text-warning-foreground">
                  {short
                    ? t('pack.sheet.noSpace', {
                        needed: formatSize(needed),
                        free: formatSize(free),
                      })
                    : t('pack.sheet.mobileWarning', { size: formatSize(needed) })}
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
      {short ? (
        <FilledButton
          label={t('pack.freeUp')}
          onPress={() => {
            close();
            router.push('/settings/downloads');
          }}
        />
      ) : mobile ? (
        <>
          <FilledButton label={t('pack.sheet.waitForWifi')} onPress={() => start(true)} />
          <FilledButton
            label={t('pack.sheet.downloadOnMobile')}
            quiet
            onPress={() => start(false)}
          />
        </>
      ) : (
        <FilledButton
          testID="pack-sheet-download"
          label={t('pack.sheet.download', { size: formatSize(needed) })}
          icon={Download}
          onPress={() => data !== undefined && start(true)}
        />
      )}
      <View className="items-center">
        <TextButton label={t('pack.sheet.cancel')} onPress={close} />
      </View>
    </View>
  );
}

/** Where the sheet appears, over everything: mount once, in the root layout. */
export function DownloadSheetHost() {
  const { t } = useTourist();
  const open = useDownloadSheet((state) => state.open);
  if (open === null) return null;
  return (
    <View className="absolute inset-0 justify-end">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('action.close')}
        onPress={close}
        className="absolute inset-0 bg-overlay/50"
      />
      <Sheet areaId={open.areaId} lang={open.lang} />
    </View>
  );
}
