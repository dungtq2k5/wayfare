import type { LucideIcon } from 'lucide-react-native';
import { CircleCheck } from 'lucide-react-native';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Icon } from '../theme/icon';
import { LARGE_TEXT_SCALE } from './layout';

interface SegmentedControlProps<T extends string> {
  options: readonly { value: T; label: string; icon?: LucideIcon }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}

/**
 * One choice of a few, side by side; each segment is a 48 dp radio. At large text the segments
 * would overflow (the 200 % frames), so they become rows, one under another (conventions §12.5).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedControlProps<T>) {
  const rows = useWindowDimensions().fontScale >= LARGE_TEXT_SCALE;
  if (rows) {
    return (
      <View accessibilityRole="radiogroup" accessibilityLabel={label} className="gap-1">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              className={`min-h-12 flex-row items-center gap-3 rounded-lg px-3 py-2 ${
                selected ? 'border-2 border-primary bg-accent' : 'border border-border bg-card'
              }`}
            >
              {option.icon !== undefined && (
                <Icon icon={option.icon} size="md" color="muted-foreground" />
              )}
              <Text className="flex-1 text-body text-foreground">{option.label}</Text>
              {selected && <Icon icon={CircleCheck} size="md" color="primary" />}
            </Pressable>
          );
        })}
      </View>
    );
  }
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
                size="sm"
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
