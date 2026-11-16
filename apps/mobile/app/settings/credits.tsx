import type { LucideIcon } from 'lucide-react-native';
import {
  ExternalLink,
  Image as ImageIcon,
  Map as MapIcon,
  Shapes,
  Type,
} from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTourist } from '../../src/i18n/use-tourist';
import { Icon } from '../../src/theme/icon';
import { LIST_END_PADDING } from '../../src/ui/layout';
import { ScreenHeader } from '../../src/ui/screen-header';

/** Each attribution's licence: the row opens it (frame S3). */
const LICENCES = {
  osm: 'https://www.openstreetmap.org/copyright',
  protomaps: 'https://protomaps.com',
  ofl: 'https://openfontlicense.org',
  lucide: 'https://lucide.dev/license',
} as const;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text accessibilityRole="header" className="px-2 text-label text-muted-foreground">
        {title}
      </Text>
      <View className="overflow-hidden rounded-xl border border-border bg-card">{children}</View>
    </View>
  );
}

function Row({
  icon,
  title,
  subtitle,
  url,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  url?: string;
}) {
  const body = (
    <View className="min-h-12 flex-row items-center gap-3 px-4 py-3">
      <Icon icon={icon} size="lg" color="muted-foreground" />
      <View className="flex-1">
        <Text className="text-body text-foreground">{title}</Text>
        <Text className="text-caption text-muted-foreground">{subtitle}</Text>
      </View>
      {url !== undefined && <Icon icon={ExternalLink} size="md" color="muted-foreground" />}
    </View>
  );
  return url === undefined ? (
    body
  ) : (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={title}
      onPress={() => void Linking.openURL(url)}
    >
      {body}
    </Pressable>
  );
}

/**
 * Credits (frame S3): the map's required attribution first — "© OpenStreetMap contributors"
 * stays in English in every language — then Protomaps, the fonts, the icons and the photos.
 */
export default function CreditsScreen() {
  const { t } = useTourist();
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title={t('settings.credits')} type="back" />
      <ScrollView contentContainerStyle={{ paddingBottom: LIST_END_PADDING }}>
        <View className="gap-6 px-4">
          <Group title={t('settings.credits.mapGroup')}>
            <Row
              icon={MapIcon}
              title={t('settings.credits.osm')}
              subtitle={t('settings.credits.osm.sub')}
              url={LICENCES.osm}
            />
            <Row
              icon={MapIcon}
              title={t('settings.credits.protomaps')}
              subtitle={t('settings.credits.protomaps.sub')}
              url={LICENCES.protomaps}
            />
          </Group>
          <Group title={t('settings.credits.typeGroup')}>
            <Row
              icon={Type}
              title={t('settings.credits.beVietnam')}
              subtitle={t('settings.credits.ofl')}
              url={LICENCES.ofl}
            />
            <Row
              icon={Type}
              title={t('settings.credits.noto')}
              subtitle={t('settings.credits.noto.sub')}
              url={LICENCES.ofl}
            />
            <Row
              icon={Shapes}
              title={t('settings.credits.lucide')}
              subtitle={t('settings.credits.isc')}
              url={LICENCES.lucide}
            />
          </Group>
          <Group title={t('settings.credits.photosGroup')}>
            <Row
              icon={ImageIcon}
              title={t('settings.credits.photos')}
              subtitle={t('settings.credits.photos.sub')}
            />
          </Group>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
