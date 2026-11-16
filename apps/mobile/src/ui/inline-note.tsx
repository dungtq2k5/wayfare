import type { LucideIcon } from 'lucide-react-native';
import { Info } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import { Icon } from '../theme/icon';

interface InlineNoteProps {
  text: string;
  icon?: LucideIcon;
  action?: { label: string; onPress: () => void };
}

/** A quiet line of explanation, with an optional action (offline, no position, no map). */
export function InlineNote({ text, icon = Info, action }: InlineNoteProps) {
  return (
    <View className="flex-row items-center gap-2 rounded-lg bg-secondary p-3">
      <Icon icon={icon} size="md" color="muted-foreground" />
      <Text className="flex-1 text-caption text-secondary-foreground">{text}</Text>
      {action !== undefined && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          className="min-h-target justify-center px-1"
        >
          <Text className="text-label text-primary">{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}
