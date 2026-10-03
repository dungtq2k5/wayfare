import { Pressable, Text } from 'react-native';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

/** A 48 dp touch target (conventions §12.5), labelled for TalkBack. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
}: ButtonProps): React.JSX.Element {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-[48px] items-center justify-center rounded-xl px-4 ${
        primary ? 'bg-emerald-700' : 'border border-emerald-700 bg-white'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className={`text-base font-semibold ${primary ? 'text-white' : 'text-emerald-800'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
