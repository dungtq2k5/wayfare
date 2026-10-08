import { Check } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Pressable, Text } from 'react-native';
import { Icon } from '../theme/icon';

/** A filter chip: filled with a check when selected, 44 dp tall. */
export function CategoryChip({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon?: LucideIcon;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`min-h-target flex-row items-center gap-1 rounded-full border px-4 ${
        selected ? 'border-primary bg-primary' : 'border-border bg-card'
      }`}
    >
      {selected ? (
        <Icon icon={Check} size={16} color="primary-foreground" />
      ) : (
        icon !== undefined && <Icon icon={icon} size={16} color="foreground" />
      )}
      <Text className={`text-label ${selected ? 'text-primary-foreground' : 'text-foreground'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
