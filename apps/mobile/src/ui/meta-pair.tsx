import type { LucideIcon } from 'lucide-react-native';
import { Text, View } from 'react-native';
import { Icon } from '../theme/icon';

/**
 * One piece of metadata: an icon and its words, built as a single unit that wraps as one, so at
 * 200 % text the icon stays beside its words (conventions §12.5).
 */
export function MetaPair({ icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <View className="shrink flex-row items-center gap-1">
      <Icon icon={icon} size={16} color="muted-foreground" />
      <Text className="shrink text-caption text-muted-foreground">{text}</Text>
    </View>
  );
}
