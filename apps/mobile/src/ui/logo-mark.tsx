import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme/appearance';
import { WORDMARK_PATHS } from './wordmark-paths';

/** The Wayfare mark alone: a pin with a lantern dot and two sound waves, in the tokens' colours. */
export function LogoMark({ size = 96 }: { size?: number }) {
  const theme = useTheme();
  const primary = theme.colors.primary;
  return (
    <Svg
      accessibilityRole="image"
      accessibilityLabel="Wayfare"
      width={size}
      height={size}
      viewBox="4 4 36 36"
    >
      <Path d={WORDMARK_PATHS.pin} fill={primary} />
      <Path d={WORDMARK_PATHS.voice} fill={theme.colors['map-marker-selected']} />
      <Path
        d={WORDMARK_PATHS.wave1}
        stroke={primary}
        strokeWidth={2.93333}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d={WORDMARK_PATHS.wave2}
        stroke={primary}
        strokeWidth={2.93333}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}
