import type { LucideIcon } from 'lucide-react-native';
import { size } from '@wayfare/design-tokens/tokens';
import type { SemanticColor } from '@wayfare/design-tokens/tokens';
import { useTheme } from './appearance';

/** The icon sizes of the design system (`size/icon-*`): a name, never a number. */
export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<IconSize, number> = {
  xs: size['icon-xs'],
  sm: size['icon-sm'],
  md: size['icon-md'],
  lg: size['icon-lg'],
  xl: size['icon-xl'],
};

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
  size: iconSize = 'lg',
  color = 'foreground',
  label,
  filled = false,
}: IconProps) {
  const theme = useTheme();
  return (
    <Glyph
      size={SIZES[iconSize]}
      strokeWidth={2}
      color={theme.colors[color]}
      fill={filled ? theme.colors[color] : 'none'}
      accessibilityLabel={label}
      accessible={label !== undefined}
      importantForAccessibility={label === undefined ? 'no' : 'yes'}
    />
  );
}
