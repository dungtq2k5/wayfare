import { Pause, Play } from 'lucide-react-native';
import { Pressable } from 'react-native';
import { Icon } from '../theme/icon';

/** The round play/pause button of the mini and inline players: a light disc, a dark glyph. */
export function PlayPauseDisc({
  paused,
  glyph,
  label,
  disabled = false,
  onPress,
}: {
  paused: boolean;
  glyph: 22 | 24;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className="h-12 w-12 items-center justify-center rounded-full bg-now-playing-foreground"
    >
      <Icon icon={paused ? Play : Pause} size={glyph} color="now-playing" />
    </Pressable>
  );
}
