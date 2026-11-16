import type { LucideIcon } from 'lucide-react-native';
import { Text, View } from 'react-native';
import { Icon } from '../theme/icon';

interface BannerProps {
  icon: LucideIcon;
  title: string;
  body: string;
}

/** A calm notice: neutral, never `destructive` (handoff: offline and stale are not errors). */
export function Banner({ icon, title, body }: BannerProps) {
  return (
    <View accessibilityRole="alert" className="flex-row gap-3 rounded-lg bg-offline p-4">
      <Icon icon={icon} size="md" color="offline-foreground" />
      <View className="flex-1 gap-1">
        <Text className="text-label text-offline-foreground">{title}</Text>
        <Text className="text-caption text-offline-foreground">{body}</Text>
      </View>
    </View>
  );
}
