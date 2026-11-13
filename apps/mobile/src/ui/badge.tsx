import type { LucideIcon } from 'lucide-react-native';
import { Text, View } from 'react-native';
import { Icon } from '../theme/icon';

type Tone = 'success' | 'sponsored' | 'warning' | 'info' | 'offline' | 'editorial';

const SURFACE: Record<Tone, string> = {
  success: 'bg-success',
  sponsored: 'bg-sponsored',
  warning: 'bg-warning',
  info: 'bg-info',
  offline: 'bg-offline',
  editorial: 'bg-editorial',
};

const INK: Record<Tone, string> = {
  success: 'text-success-foreground',
  sponsored: 'text-sponsored-foreground',
  warning: 'text-warning-foreground',
  info: 'text-info-foreground',
  offline: 'text-offline-foreground',
  editorial: 'text-editorial-foreground',
};

/** A short status with a word (never a tint alone), and optionally an icon beside it. */
export function Badge({ tone, label, icon }: { tone: Tone; label: string; icon?: LucideIcon }) {
  return (
    <View
      className={`flex-row items-center gap-1 self-start rounded-full px-3 py-1 ${SURFACE[tone]}`}
    >
      {icon !== undefined && (
        <Icon icon={icon} size="sm" color={`${tone}-foreground` as 'success-foreground'} />
      )}
      <Text className={`shrink text-label ${INK[tone]}`}>{label}</Text>
    </View>
  );
}
