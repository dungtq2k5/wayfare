import { Pressable, Text, View } from 'react-native';
import { Icon } from '../theme/icon';
import type { NoteView } from './use-player';

/** One line with an icon in the accent colour; never red. */
export function PlayerNote({ note, onSurface = true }: { note: NoteView; onSurface?: boolean }) {
  const ink = onSurface ? 'text-now-playing-foreground' : 'text-foreground';
  return (
    <View className="min-h-12 flex-row items-center gap-2" accessibilityLiveRegion="polite">
      <Icon icon={note.icon} size="md" color="now-playing-accent" />
      <Text className={`flex-1 text-caption ${ink}`} maxFontSizeMultiplier={1.3}>
        {note.text}
      </Text>
      {note.action !== null && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={note.action.label}
          onPress={note.action.onPress}
          className="min-h-12 min-w-12 items-center justify-center px-2"
        >
          <Text className="text-label text-now-playing-accent">{note.action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}
