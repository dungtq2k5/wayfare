import type { LucideIcon } from 'lucide-react-native';
import type { SemanticColor } from '@wayfare/design-tokens/tokens';
import { useTheme } from './appearance';

/** The designer's three icon sizes (16, 20, 24 dp); Lucide, stroke 2. */
export type IconSize = 16 | 20 | 24;

interface IconProps {
  icon: LucideIcon;
  size?: IconSize;
  /** A semantic colour token, resolved for the active mode. */
  color?: SemanticColor;
  /** The label TalkBack reads; omit for a decorative icon beside text. */
  label?: string;
}

/** The one place an icon gets its colour: from the tokens, never a literal. */
export function Icon({ icon: Glyph, size = 24, color = 'foreground', label }: IconProps) {
  const theme = useTheme();
  return (
    <Glyph
      size={size}
      strokeWidth={2}
      color={theme.colors[color]}
      accessibilityLabel={label}
      accessible={label !== undefined}
      importantForAccessibility={label === undefined ? 'no' : 'yes'}
    />
  );
}
