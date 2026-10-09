import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronDown, FileText, Info, Navigation, Play } from 'lucide-react-native';
import { categoryIcon } from '../src/map/categories';
import { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, Text, View, PanResponder, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTourist } from '../src/i18n/use-tourist';
import { areaNameOf } from '../src/player/area-name';
import { PlayerNote } from '../src/player/player-note';
import { Scrubber } from '../src/player/scrubber';
import { usePlayerStore } from '../src/player/store';
import { Transport } from '../src/player/transport';
import { UpNextRow } from '../src/player/up-next-row';
import { useNote } from '../src/player/use-player';
import { formatDistance } from '../src/places/format-distance';
import { Icon } from '../src/theme/icon';
import { PlacePhoto } from '../src/ui/place-photo';

/** The artwork's size at the largest text sizes. */
const SMALL_ARTWORK = 120;

/** How far a drag on the handle closes the player. */
const CLOSE_DRAG = 80;

/**
 * The expanded Now-playing screen: a modal over everything, rendered from the
 * player's state — when one narration ends and the next starts, it switches to the new Place.
 */
export default function PlayerScreen() {
  const { t, tFamily } = useTourist();
  const router = useRouter();
  const current = usePlayerStore((state) => state.current);
  const note = useNote();
  const { fontScale } = useWindowDimensions();

  // Nothing playing any more (Stop, Cancel, the end of the last narration): the screen has nothing
  // to show and closes — but only while it is in front. With the Place's detail opened over it,
  // `back` would close the detail and leave this screen empty; it closes when it is reached again.
  useFocusEffect(
    useCallback(() => {
      if (current === null && router.canGoBack()) router.back();
    }, [current, router]),
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > CLOSE_DRAG && router.canGoBack()) router.back();
        },
      }),
    [router],
  );

  if (current === null) return <View className="flex-1 bg-now-playing" />;
  const { place } = current;
  const header =
    current.source === null
      ? t('player.header.preparing')
      : current.paused !== null
        ? t('player.header.paused')
        : t('player.header.playing');
  const reason =
    current.started === 'auto'
      ? current.distanceM === null
        ? t('player.reason.nearby')
        : t('player.reason.nearbyDistance', { distance: formatDistance(current.distanceM) })
      : t('player.reason.chosen');
  const timeline =
    current.source === 'file' && current.positionMs !== null && current.durationMs !== null;
  // At the largest text sizes the artwork shrinks to leave room for the words.
  const shrunk = fontScale >= 1.5;

  return (
    <SafeAreaView className="flex-1 bg-now-playing">
      <ScrollView contentContainerClassName="gap-4 p-4">
        <View {...pan.panHandlers} className="min-h-12 items-center justify-center">
          <View className="h-1 w-10 rounded-full bg-now-playing-foreground/40" />
        </View>
        <View className="flex-row items-center justify-between">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('player.collapse')}
            onPress={() => router.back()}
            className="h-12 w-12 items-center justify-center"
          >
            <Icon icon={ChevronDown} size="lg" color="now-playing-foreground" />
          </Pressable>
          <Text accessibilityRole="header" className="text-label text-now-playing-foreground">
            {header}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('player.aboutPlace')}
            onPress={() => router.push({ pathname: '/place/[id]', params: { id: place.id } })}
            className="h-12 w-12 items-center justify-center"
          >
            <Icon icon={Info} size="lg" color="now-playing-foreground" />
          </Pressable>
        </View>

        <View className="items-center">
          <View
            style={shrunk ? { width: SMALL_ARTWORK, height: SMALL_ARTWORK } : undefined}
            className={shrunk ? '' : 'aspect-video w-full'}
          >
            <PlacePhoto
              uri={place.cardPhotoUrl}
              categoryCode={place.categoryCode}
              className="h-full w-full"
            />
          </View>
        </View>

        <View className="gap-1">
          <Text accessibilityRole="header" className="text-title text-now-playing-foreground">
            {place.name}
          </Text>
          <View className="flex-row items-center gap-2">
            <Icon
              icon={categoryIcon(place.categoryCode)}
              size="md"
              color="now-playing-foreground"
            />
            <Text className="flex-1 text-body text-now-playing-foreground">
              {tFamily('category', place.categoryCode, tFamily('category', 'OTHER'))} ·{' '}
              {areaNameOf(place.areaId)}
            </Text>
          </View>
          {reason !== null && (
            <View className="flex-row items-center gap-2">
              <Icon
                icon={current.started === 'auto' ? Navigation : Play}
                size="sm"
                color="now-playing-accent"
              />
              <Text className="flex-1 text-caption text-now-playing-accent">{reason}</Text>
            </View>
          )}
          {!place.ownLanguage && (
            <Text className="text-caption text-now-playing-accent">{t('place.notInLanguage')}</Text>
          )}
        </View>

        {note !== null && <PlayerNote note={note} />}
        {timeline && (
          <Scrubber positionMs={current.positionMs ?? 0} durationMs={current.durationMs ?? 0} />
        )}
        <Transport />

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/transcript')}
          className="min-h-12 flex-row items-center justify-center gap-2 rounded-full border border-now-playing-foreground"
        >
          <Icon icon={FileText} size="md" color="now-playing-foreground" />
          <Text className="text-label text-now-playing-foreground">{t('player.transcript')}</Text>
        </Pressable>
        <UpNextRow />
      </ScrollView>
    </SafeAreaView>
  );
}
