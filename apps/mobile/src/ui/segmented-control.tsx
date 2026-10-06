import { Pressable, Text, View } from 'react-native';

interface SegmentedControlProps<T extends string> {
  options: readonly { value: T; label: string }[];
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
            className={`min-h-12 flex-1 items-center justify-center rounded-md px-2 ${selected ? 'bg-primary' : ''}`}
          >
            <Text
              className={`text-center text-label ${selected ? 'text-primary-foreground' : 'text-secondary-foreground'}`}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
