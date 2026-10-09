import { Pressable, Text, View } from 'react-native';
import { useTourist } from '../i18n/use-tourist';
import { categoryIcon } from '../map/categories';
import { Icon } from '../theme/icon';
import { narrationPlayer } from './narration-player';
import { usePlayerStore } from './store';

/** *Up next* at the foot of the expanded player, or the quiet line when nothing waits. */
export function UpNextRow() {
  const { t } = useTourist();
  const next = usePlayerStore((state) => state.next);
  if (next === null) {
    return (
      <Text className="text-caption text-now-playing-foreground">{t('player.nothingWaiting')}</Text>
    );
  }
  return (
    <View className="flex-row flex-wrap items-center gap-3 rounded-xl bg-now-playing-foreground/10 p-3">
      <View className="h-12 w-12 items-center justify-center rounded-lg bg-now-playing-accent">
        <Icon icon={categoryIcon(next.categoryCode)} size="lg" color="now-playing" />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-caption text-now-playing-accent">{t('player.upNext')}</Text>
        <Text className="text-body-strong text-now-playing-foreground">{next.name}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('player.playNow')}: ${next.name}`}
        onPress={() => narrationPlayer.skip()}
        className="min-h-12 items-center justify-center px-2"
      >
        <Text className="text-label text-now-playing-foreground">{t('player.playNow')}</Text>
      </Pressable>
    </View>
  );
}
