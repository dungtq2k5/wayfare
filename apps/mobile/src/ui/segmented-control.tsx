import type { LucideIcon } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import { Icon } from '../theme/icon';

interface SegmentedControlProps<T extends string> {
  options: readonly { value: T; label: string; icon?: LucideIcon }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}

/** One choice of a few, side by side; each segment is a 48 dp radio. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedControlProps<T>) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      className="flex-row gap-1 rounded-lg bg-secondary p-1"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            className={`min-h-12 flex-1 flex-row items-center justify-center gap-1 rounded-md px-2 ${selected ? 'bg-card elevation-1' : ''}`}
          >
            {option.icon !== undefined && (
              <Icon
                icon={option.icon}
                size={16}
                color={selected ? 'foreground' : 'muted-foreground'}
              />
            )}
            <Text
              className={`shrink text-center text-label ${selected ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
