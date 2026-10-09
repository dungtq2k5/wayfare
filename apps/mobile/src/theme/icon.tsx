import type { LucideIcon } from 'lucide-react-native';
import type { SemanticColor } from '@wayfare/design-tokens/tokens';
import { useTheme } from './appearance';

/**
 * The designer's icon sizes (16, 20, 24 dp; Lucide, stroke 2), 22 for the inline player's glyphs
 * and 32 for the one on the full player's play/pause disc.
 */
export type IconSize = 12 | 16 | 20 | 22 | 24 | 32;

interface IconProps {
  icon: LucideIcon;
  size?: IconSize;
  /** A semantic colour token, resolved for the active mode. */
  color?: SemanticColor;
  /** The label TalkBack reads; omit for a decorative icon beside text. */
  label?: string;
  /** Filled with its colour (a saved heart), not just outlined. */
  filled?: boolean;
}

/** The one place an icon gets its colour: from the tokens, never a literal. */
export function Icon({
  icon: Glyph,
  size = 24,
  color = 'foreground',
  label,
  filled = false,
}: IconProps) {
  const theme = useTheme();
  return (
    <Glyph
      size={size}
      strokeWidth={2}
      color={theme.colors[color]}
      fill={filled ? theme.colors[color] : 'none'}
      accessibilityLabel={label}
      accessible={label !== undefined}
      importantForAccessibility={label === undefined ? 'no' : 'yes'}
    />
  );
}
