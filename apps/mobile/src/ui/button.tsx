import { Pressable, Text } from 'react-native';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'destructive';
  disabled?: boolean;
}

const SURFACE = {
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  destructive: 'bg-destructive',
} as const;

const INK = {
  primary: 'text-primary-foreground',
  secondary: 'text-secondary-foreground',
  destructive: 'text-destructive-foreground',
} as const;

/** A 48 dp touch target (conventions §12.5), labelled for TalkBack. */
export function Button({ label, onPress, variant = 'primary', disabled = false }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-12 items-center justify-center rounded-lg px-4 py-3 ${SURFACE[variant]} ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className={`text-center text-body-strong ${INK[variant]}`}>{label}</Text>
    </Pressable>
  );
}
