import { LoaderCircle } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Animated, Easing } from 'react-native';
import { size } from '@wayfare/design-tokens/tokens';
import type { SemanticColor } from '@wayfare/design-tokens/tokens';
import { useTheme } from './appearance';
import { useDuration } from './use-duration';

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
  const glyph = (
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
  // `LoaderCircle` means work in progress, and nothing else in the app: it turns wherever it is.
  return Glyph === LoaderCircle ? <Turning size={SIZES[iconSize]}>{glyph}</Turning> : glyph;
}

/**
 * One turn per `duration.spin`, on the UI thread. Still when the system removes animations: the
 * duration is then 0 and no loop starts (conventions §12.5).
 */
function Turning({ size: side, children }: { size: number; children: ReactNode }) {
  const spin = useDuration('spin');
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    turn.setValue(0);
    if (spin === 0) return;
    const loop = Animated.loop(
      Animated.timing(turn, {
        toValue: 1,
        duration: spin,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  // Exactly the icon's box: a row that stretches its children would otherwise make it taller, and
  // the icon would swing around the middle of that box instead of turning in place.
  return (
    <Animated.View style={{ width: side, height: side, transform: [{ rotate }] }}>
      {children}
    </Animated.View>
  );
}
