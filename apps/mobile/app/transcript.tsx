import { useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Language } from '@wayfare/contracts';
import { LANGUAGE_NAMES } from '../src/i18n/languages';
import { useTourist } from '../src/i18n/use-tourist';
import { MiniPlayer } from '../src/player/mini-player';
import { usePlayerStore } from '../src/player/store';
import { clock } from '../src/player/use-player';
import { usePlaceView } from '../src/places/use-place-view';
import { ScreenHeader } from '../src/ui/screen-header';

function Words({
  name,
  text,
  ownLanguage,
  meta,
}: {
  name: string;
  text: string;
  ownLanguage: boolean;
  /** Category · language · length (T1), when the narration is known. */
  meta?: { categoryCode: string; lang: string; durationMs: number | null };
}) {
  const { t, tFamily } = useTourist();
  const metaLine =
    meta === undefined
      ? null
      : [
          tFamily('category', meta.categoryCode, tFamily('category', 'OTHER')),
          LANGUAGE_NAMES[meta.lang as Language] ?? meta.lang,
          meta.durationMs === null ? null : clock(meta.durationMs),
        ]
          .filter((part) => part !== null)
          .join(' · ');
  return (
    <ScrollView contentContainerClassName="gap-3 px-4 pb-6">
      <View className="gap-1">
        <Text accessibilityRole="header" className="text-heading text-foreground">
          {name}
        </Text>
        {metaLine !== null && (
          <Text className="text-caption text-muted-foreground">{metaLine}</Text>
        )}
      </View>
      {!ownLanguage && (
        <Text className="text-caption text-info-foreground">{t('place.notInLanguage')}</Text>
      )}
      <Text selectable className="text-body text-foreground">
        {text === '' ? t('player.noTranscript') : text}
      </Text>
    </ScrollView>
  );
}

/** A Place that is not playing, read by its id (*Read* on a Place with no narration). */
function OtherPlace({ placeId }: { placeId: string }) {
  const state = usePlaceView(placeId);
  if (state.kind !== 'ready') return null;
  return (
    <Words
      name={state.view.name}
      text={state.view.description}
      ownLanguage={state.view.contentTier === 'REQUESTED'}
    />
  );
}

/**
 * The transcript: the whole text on `background`, nothing highlighted because the
 * reading position is not known, with the mini player pinned below so the narration can be paused
 * while reading.
 */
export default function TranscriptScreen() {
  const { t } = useTourist();
  const { placeId } = useLocalSearchParams<{ placeId?: string }>();
  const current = usePlayerStore((state) => state.current);
  const playing = current !== null && (placeId === undefined || current.place.id === placeId);

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title={t('player.transcriptTitle')} type="back" />
      {playing ? (
        <Words
          name={current.place.name}
          text={current.place.text}
          ownLanguage={current.place.ownLanguage}
          meta={{
            categoryCode: current.place.categoryCode,
            lang: current.place.textLang,
            durationMs: current.durationMs ?? current.place.audio?.durationMs ?? null,
          }}
        />
      ) : placeId === undefined ? null : (
        <OtherPlace placeId={placeId} />
      )}
      <View>
        <MiniPlayer floating={false} />
      </View>
    </SafeAreaView>
  );
}
