import { useAreasList } from '@wayfare/api-client';
import type { AreaResponseDto } from '@wayfare/api-client';
import type { Language } from '@wayfare/contracts';
import { router } from 'expo-router';
import { ChevronRight, RefreshCw } from 'lucide-react-native';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LANGUAGE_NAMES } from '../../src/i18n/languages';
import { useTourist } from '../../src/i18n/use-tourist';
import { areaIcon } from '../../src/ui/categories';
import { packKey, usePackStore } from '../../src/packs/controller';
import type { Pack } from '../../src/packs/db';
import { openDownloadSheet } from '../../src/packs/download-sheet';
import { freeBytes } from '../../src/packs/engine-deps';
import { formatSize, shortDate } from '../../src/packs/format';
import { PackStateLine } from '../../src/packs/pack-ui';
import { usePackSettings } from '../../src/packs/settings';
import { usePackCounts, usePackPlan, usePackUsage } from '../../src/packs/use-pack-plan';
import { useAppStore } from '../../src/state/app-store';
import { useTheme } from '../../src/theme/appearance';
import { Icon } from '../../src/theme/icon';
import { LIST_END_PADDING } from '../../src/ui/layout';
import { ScreenHeader } from '../../src/ui/screen-header';

function AreaTile({ code }: { code: string }) {
  return (
    <View className="h-12 w-12 items-center justify-center rounded-lg bg-secondary">
      <Icon icon={areaIcon(code)} size="lg" color="foreground" />
    </View>
  );
}

/** A downloaded area: its tile, name, language, size and date, and its pack state (*Pack row*). */
function PackRow({ pack, area }: { pack: Pack; area: AreaResponseDto | undefined }) {
  const { t, tFamily } = useTourist();
  const language = useAppStore((state) => state.language) ?? 'en';
  const progress = usePackStore((state) => state.progress[packKey(pack.areaId, pack.lang)]);
  const code = area?.code ?? pack.areaId.slice(0, 8);
  const name = tFamily('area', code, code);
  const date = pack.updatedAt ?? pack.installedAt;
  const meta = [
    LANGUAGE_NAMES[pack.lang as Language] ?? pack.lang,
    formatSize(pack.bytes),
    ...(date === null ? [] : [t('pack.screen.updated', { date: shortDate(date, language) })]),
  ].join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={() =>
        router.push({
          pathname: '/settings/pack',
          params: { areaId: pack.areaId, lang: pack.lang },
        })
      }
      className="min-h-12 flex-row items-center gap-3 px-4 py-3"
    >
      <AreaTile code={code} />
      <View className="flex-1 gap-1">
        <Text className="text-body-strong text-foreground">{name}</Text>
        <Text className="text-caption text-muted-foreground">{meta}</Text>
        <PackStateLine pack={pack} progress={progress} />
      </View>
      <Icon icon={ChevronRight} size="md" color="muted-foreground" />
    </Pressable>
  );
}

/** An area with no download yet: its size in the app's language, and the sheet on a tap. */
function AvailableRow({ area }: { area: AreaResponseDto }) {
  const { t, tFamily } = useTourist();
  const language = useAppStore((state) => state.language) ?? 'en';
  const plan = usePackPlan(area.id, language);
  const counts = usePackCounts(area.id);
  const name = tFamily('area', area.code, area.code);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={() => openDownloadSheet(area.id, language)}
      className="min-h-12 flex-row items-center gap-3 px-4 py-3"
    >
      <AreaTile code={area.code} />
      <View className="flex-1 gap-1">
        <Text className="text-body-strong text-foreground">{name}</Text>
        <Text className="text-caption text-muted-foreground">
          {`${LANGUAGE_NAMES[language]} · ${t('pack.part.places', { count: counts.places })}`}
        </Text>
        <PackStateLine pack={null} progress={undefined} downloadSize={plan.data?.needed ?? null} />
      </View>
      <Icon icon={ChevronRight} size="md" color="muted-foreground" />
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text accessibilityRole="header" className="px-2 text-label text-muted-foreground">
        {title}
      </Text>
      <View className="overflow-hidden rounded-xl border border-border bg-card">{children}</View>
    </View>
  );
}

/**
 * *Offline downloads* (frames M1, M1b): the space used and free, the automatic-update switch, what
 * is downloaded, then what can be.
 */
export default function DownloadsScreen() {
  const { t } = useTourist();
  const theme = useTheme();
  const packs = usePackStore((state) => state.packs);
  const areas = useAreasList().data?.data ?? [];
  const autoUpdate = usePackSettings((state) => state.autoUpdate);
  const usage = usePackUsage();
  const downloaded = new Set(packs.map((pack) => pack.areaId));
  const available = areas.filter((area) => !downloaded.has(area.id));
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title={t('pack.downloads')} type="back" />
      <ScrollView contentContainerStyle={{ paddingBottom: LIST_END_PADDING }}>
        <View className="gap-6 px-4">
          <View className="gap-1 rounded-xl bg-card p-4">
            <Text className="text-body-strong text-foreground">
              {t('pack.downloads.usage', {
                used: formatSize(usage.bytes),
                free: formatSize(freeBytes()),
              })}
            </Text>
          </View>
          {/* The whole row is the switch: its words are the bigger target. */}
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: autoUpdate }}
            accessibilityLabel={t('pack.downloads.auto')}
            onPress={() => usePackSettings.setState({ autoUpdate: !autoUpdate })}
            className="flex-row items-center gap-3 rounded-xl bg-card p-4"
          >
            <Icon icon={RefreshCw} size="lg" color="muted-foreground" />
            <View className="flex-1 gap-1">
              <Text className="text-body text-foreground">{t('pack.downloads.auto')}</Text>
              <Text className="text-caption text-muted-foreground">
                {t('pack.downloads.autoHint')}
              </Text>
            </View>
            <Switch
              value={autoUpdate}
              onValueChange={(on) => {
                usePackSettings.setState({ autoUpdate: on });
              }}
              trackColor={{ true: theme.colors.primary, false: theme.colors.muted }}
              thumbColor={theme.colors.card}
              importantForAccessibility="no"
            />
          </Pressable>
          {packs.length === 0 ? (
            <View className="gap-1 px-2">
              <Text className="text-heading text-foreground">{t('pack.downloads.emptyTitle')}</Text>
              <Text className="text-body text-muted-foreground">
                {t('pack.downloads.emptyBody')}
              </Text>
            </View>
          ) : (
            <Section title={t('pack.downloads.downloaded')}>
              {packs.map((pack) => (
                <PackRow
                  key={packKey(pack.areaId, pack.lang)}
                  pack={pack}
                  area={areas.find((area) => area.id === pack.areaId)}
                />
              ))}
            </Section>
          )}
          {available.length > 0 && (
            <Section title={t('pack.downloads.available')}>
              {available.map((area) => (
                <AvailableRow key={area.id} area={area} />
              ))}
            </Section>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
