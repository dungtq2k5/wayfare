import { distanceMeters, walkingEtaMinutes } from '@wayfare/core';
import { space } from '@wayfare/design-tokens/tokens';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTourist } from '../../src/i18n/use-tourist';
import { usePosition } from '../../src/location/use-position';
import { PlaceDetail, PlaceUnavailable } from '../../src/places/place-detail';
import { usePlaceView } from '../../src/places/use-place-view';
import { Icon } from '../../src/theme/icon';
import { LIST_END_PADDING } from '../../src/ui/layout';
import { ScreenHeader } from '../../src/ui/screen-header';

/** A Place's whole detail: the gallery, hours, menu and contact online; the synced fields offline. */
export default function PlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTourist();
  const router = useRouter();
  const position = usePosition();
  const state = usePlaceView(id);
  const insets = useSafeAreaInsets();
  const [scrolled, setScrolled] = useState(false);

  if (state.kind === 'removed' || state.kind === 'error') {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <ScreenHeader title="" type="back" />
        <PlaceUnavailable
          kind={state.kind}
          onBack={() => router.replace('/map')}
          {...(state.kind === 'error' ? { onRetry: state.retry } : {})}
        />
      </SafeAreaView>
    );
  }
  if (state.kind === 'loading') {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator accessibilityLabel={t('map.firstSync')} />
      </SafeAreaView>
    );
  }
  const { view } = state;
  const distanceM = position === null ? null : distanceMeters(position, view.location);
  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingBottom: LIST_END_PADDING }}
        scrollEventThrottle={32}
        onScroll={(event) => setScrolled(event.nativeEvent.contentOffset.y > 24)}
      >
        <PlaceDetail
          view={view}
          level="full"
          distance={
            distanceM === null ? null : { distanceM, walkingMinutes: walkingEtaMinutes(distanceM) }
          }
        />
      </ScrollView>
      {/* Over the gallery the back button floats; once the page scrolls, a solid bar holds it and the status bar, so no text shows through. */}
      <View
        pointerEvents="none"
        style={{ height: scrolled ? insets.top + 64 : insets.top }}
        className="absolute inset-x-0 top-0 bg-background"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('settings.back')}
        onPress={() => router.back()}
        style={{ top: insets.top + space[2] }}
        className="absolute left-4 min-h-12 min-w-12 items-center justify-center rounded-full bg-card elevation-2"
      >
        <Icon icon={ArrowLeft} size={24} />
      </Pressable>
    </View>
  );
}
