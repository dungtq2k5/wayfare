import type { LucideIcon } from 'lucide-react-native';
import { LoaderCircle } from 'lucide-react-native';
import { Pressable, Text } from 'react-native';
import { Icon } from '../theme/icon';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'destructive';
  disabled?: boolean;
  /** A glyph before the label, in the label's colour. */
  icon?: LucideIcon;
  /** A request running: the spinner in place of the glyph, and further taps ignored. */
  loading?: boolean;
  testID?: string;
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

const GLYPH = {
  primary: 'primary-foreground',
  secondary: 'secondary-foreground',
  destructive: 'destructive-foreground',
} as const;

/** A 48 dp touch target (conventions §12.5), labelled for TalkBack. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  icon,
  loading = false,
  testID,
}: ButtonProps) {
  const glyph = loading ? LoaderCircle : icon;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      className={`min-h-12 flex-row items-center justify-center gap-2 rounded-lg px-4 py-3 ${SURFACE[variant]} ${disabled ? 'opacity-50' : ''}`}
    >
      {glyph !== undefined && <Icon icon={glyph} size="md" color={GLYPH[variant]} />}
      <Text className={`text-center text-body-strong ${INK[variant]}`}>{label}</Text>
    </Pressable>
  );
}
