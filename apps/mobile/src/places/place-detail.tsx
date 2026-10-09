import { Image } from 'expo-image';
import {
  CheckCircle2,
  CloudOff,
  Compass,
  ExternalLink,
  Globe,
  Languages,
  MapPin,
  Phone,
  Play,
  Map as MapIcon,
  RefreshCw,
  Wallet,
  XCircle,
} from 'lucide-react-native';
import { isSupportedLanguage } from '@wayfare/contracts';
import { useState } from 'react';
import { FlatList, Linking, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useTourist } from '../i18n/use-tourist';
import { LANGUAGE_NAMES } from '../i18n/languages';
import { categoryIcon } from '../map/categories';
import { InlinePlayer } from '../player/inline-player';
import { narrationPlayer } from '../player/narration-player';
import { usePlayerStore } from '../player/store';
import { useAppStore } from '../state/app-store';
import { Icon } from '../theme/icon';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { FavouriteToggle } from '../ui/favourite-toggle';
import { InlineNote } from '../ui/inline-note';
import { MetaPair } from '../ui/meta-pair';
import { PlacePhoto } from '../ui/place-photo';
import { HoursBlock } from './hours-block';
import { formatDuration, formatPrice, playerPlaceOf } from './place-view';
import type { PlaceView } from './place-view';
import { useOpenSummary } from './use-open-state';
import { useDistanceText } from './use-walk-text';

/** How much of the detail shows: the sheet's peek, its half, or everything. */
export type DetailLevel = 'peek' | 'half' | 'full';

const open = (url: string) => void Linking.openURL(url);

function Gallery({ view }: { view: PlaceView }) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  if (view.photos.length === 0) {
    return (
      <PlacePhoto uri={null} categoryCode={view.categoryCode} className="aspect-video w-full" />
    );
  }
  return (
    <View>
      <FlatList
        data={view.photos}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(photo) => photo.id}
        onMomentumScrollEnd={(event) =>
          setIndex(Math.round(event.nativeEvent.contentOffset.x / width))
        }
        renderItem={({ item }) => (
          <Image
            source={{ uri: item.card }}
            contentFit="cover"
            accessibilityLabel={item.alt ?? undefined}
            style={{ width, aspectRatio: 16 / 9 }}
          />
        )}
      />
      {view.photos.length > 1 && (
        <View className="absolute bottom-2 w-full flex-row justify-center gap-1">
          {view.photos.map((photo, position) => (
            <View
              key={photo.id}
              className={`h-2 w-2 rounded-full ${position === index ? 'bg-card' : 'bg-card/50'}`}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function QuickActions({ view }: { view: PlaceView }) {
  const { t } = useTourist();
  const { lat, lng } = view.location;
  const actions = [
    {
      key: 'directions',
      icon: Compass,
      label: t('place.directions'),
      onPress: () =>
        open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`),
    },
    {
      key: 'maps',
      icon: ExternalLink,
      label: t('place.googleMaps'),
      onPress: () => open(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`),
    },
    ...(view.phone === null
      ? []
      : [
          {
            key: 'call',
            icon: Phone,
            label: t('place.call'),
            onPress: () => open(`tel:${view.phone}`),
          },
        ]),
    ...(view.websiteUrl === null
      ? []
      : [
          {
            key: 'web',
            icon: Globe,
            label: t('place.website'),
            onPress: () => open(view.websiteUrl!),
          },
        ]),
  ];
  return (
    <View className="flex-row flex-wrap gap-2">
      {actions.map((action) => (
        <Pressable
          key={action.key}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          className="min-h-12 flex-row items-center gap-2 rounded-lg border border-border bg-card px-4"
        >
          <Icon icon={action.icon} size={20} color="primary" />
          <Text className="text-label text-foreground">{action.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Menu({ view }: { view: PlaceView }) {
  const { t } = useTourist();
  if (view.menu === null || view.menu.items.length === 0) return null;
  const { currency } = view.menu;
  return (
    <View className="gap-2">
      <Text accessibilityRole="header" className="text-heading text-foreground">
        {t('place.menu')}
      </Text>
      {view.menu.items.map((item) => (
        <View key={item.id} className="gap-1 border-b border-border py-2">
          <View className="flex-row flex-wrap justify-between gap-x-3">
            <Text
              className={`shrink text-body-strong ${item.isAvailable ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              {item.name}
            </Text>
            {item.priceMinor !== null && (
              <Text className="text-body text-foreground">
                {formatPrice(item.priceMinor, currency)}
              </Text>
            )}
          </View>
          {item.description !== null && (
            <Text className="text-caption text-muted-foreground">{item.description}</Text>
          )}
          {!item.isAvailable && <Badge tone="offline" label={t('place.menu.unavailable')} />}
        </View>
      ))}
    </View>
  );
}

/**
 * The Place's facts, as much as `level` shows (the sheet's peek and half, the whole detail). The
 * online answer has everything; the offline record has the synced fields, and says so (C3).
 */
export function PlaceDetail({
  view,
  level,
  distance,
}: {
  view: PlaceView;
  level: DetailLevel;
  distance?: { distanceM: number; walkingMinutes: number } | null;
}) {
  const { t, tFamily } = useTourist();
  const summary = useOpenSummary(view.openingHours);
  const distanceText = useDistanceText();
  const yourLanguage = LANGUAGE_NAMES[useAppStore((state) => state.language) ?? 'en'];
  // The text's own language, when this build has a name for it.
  const shownLanguage = isSupportedLanguage(view.lang) ? LANGUAGE_NAMES[view.lang] : null;
  const price =
    view.priceBand === null || view.priceBand < 1 ? null : '$'.repeat(Math.min(view.priceBand, 4));
  const ownLanguage = view.contentTier === 'REQUESTED';
  const playingHere = usePlayerStore((state) => state.current?.place.id === view.id);
  const shownBadgeLanguage =
    view.contentTier === 'ENGLISH'
      ? LANGUAGE_NAMES.en
      : view.contentTier === 'SOURCE'
        ? LANGUAGE_NAMES.vi
        : shownLanguage;

  return (
    <View className="gap-4">
      {level === 'full' && <Gallery view={view} />}
      <View className="gap-3 px-4">
        <View className="flex-row items-start gap-2">
          <Text accessibilityRole="header" className="flex-1 text-title text-foreground">
            {view.name}
          </Text>
          <FavouriteToggle placeId={view.id} />
        </View>
        <View className="flex-row flex-wrap gap-x-3 gap-y-1">
          <MetaPair
            icon={categoryIcon(view.categoryCode)}
            text={tFamily('category', view.categoryCode, tFamily('category', 'OTHER'))}
          />
          {distance !== undefined && distance !== null && (
            <MetaPair
              icon={MapPin}
              text={distanceText(distance.distanceM, distance.walkingMinutes)}
            />
          )}
          {price !== null && <MetaPair icon={Wallet} text={price} />}
        </View>
        {!ownLanguage && (
          <View className="flex-row items-center gap-2">
            <Icon icon={Languages} size={16} color="info-foreground" />
            <Text className="flex-1 text-caption text-info-foreground">
              {view.contentTier === 'ENGLISH'
                ? t('place.shownInEnglish', { language: yourLanguage })
                : view.contentTier === 'SOURCE'
                  ? t('place.shownInSource', { language: yourLanguage })
                  : shownLanguage === null
                    ? t('place.notInLanguage')
                    : t('place.shownInOther', { shown: shownLanguage, language: yourLanguage })}
            </Text>
          </View>
        )}
        <View className="flex-row flex-wrap gap-2">
          {!ownLanguage && shownBadgeLanguage !== null && (
            <Badge
              tone="info"
              icon={Languages}
              label={t('place.shownBadge', { language: shownBadgeLanguage })}
            />
          )}
          {view.kind === 'EDITORIAL' && (
            <Badge tone="editorial" icon={CheckCircle2} label={t('place.editorsPick')} />
          )}
          {view.stale && <Badge tone="warning" icon={RefreshCw} label={t('place.beingUpdated')} />}
          {summary !== null && <Badge tone={summary.tone} label={summary.text} />}
        </View>
        {playingHere ? (
          <InlinePlayer />
        ) : (
          <Button
            label={
              view.audioDurationMs === null
                ? t('place.listen')
                : t('place.listenDuration', { duration: formatDuration(view.audioDurationMs) })
            }
            icon={Play}
            onPress={() => narrationPlayer.play(playerPlaceOf(view))}
          />
        )}
      </View>

      {level !== 'peek' && (
        <View className="gap-4 px-4">
          {view.description !== '' && (
            <Text className="text-body text-foreground">{view.description}</Text>
          )}
          {view.address !== null && (
            <View className="gap-1">
              <Text accessibilityRole="header" className="text-heading text-foreground">
                {t('place.address')}
              </Text>
              <Text selectable className="text-body text-foreground">
                {view.address}
              </Text>
            </View>
          )}
          <QuickActions view={view} />
        </View>
      )}

      {level === 'full' && (
        <View className="gap-4 px-4 pb-6">
          <View className="gap-2">
            <Text accessibilityRole="header" className="text-heading text-foreground">
              {t('place.hours')}
            </Text>
            <HoursBlock rows={view.openingHours} />
          </View>
          <Menu view={view} />
          {view.source === 'offline' && (
            <InlineNote icon={CloudOff} text={t('place.offline.note')} />
          )}
        </View>
      )}
    </View>
  );
}

/** Why a Place cannot be shown: it left Wayfare, or it would not load. */
export function PlaceUnavailable({
  kind,
  onRetry,
  onBack,
}: {
  kind: 'removed' | 'error';
  onRetry?: () => void;
  /** Where *Back to the map* goes. */
  onBack?: () => void;
}) {
  const { t } = useTourist();
  return (
    <View className="items-center gap-4 p-6">
      <View className="rounded-full bg-accent p-5">
        <Icon icon={XCircle} size={24} color="accent-foreground" />
      </View>
      <Text accessibilityRole="header" className="text-center text-heading text-foreground">
        {kind === 'removed' ? t('place.removed.title') : t('place.loadError')}
      </Text>
      {kind === 'removed' && (
        <Text className="text-center text-body text-muted-foreground">
          {t('place.removed.body')}
        </Text>
      )}
      {kind === 'error' && onRetry !== undefined && (
        <Button label={t('action.retry')} onPress={onRetry} />
      )}
      {onBack !== undefined && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('place.removed.action')}
          onPress={onBack}
          className="min-h-12 flex-row items-center gap-2 rounded-lg bg-secondary px-4"
        >
          <Icon icon={MapIcon} size={20} color="secondary-foreground" />
          <Text className="text-label text-secondary-foreground">{t('place.removed.action')}</Text>
        </Pressable>
      )}
    </View>
  );
}
