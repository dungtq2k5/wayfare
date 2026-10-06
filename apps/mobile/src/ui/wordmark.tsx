import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme/appearance';
import { WORDMARK_BOX, WORDMARK_PATHS } from './wordmark-paths';

/** The logo: pin, lantern dot, sound waves and the word, in the primary token for the active mode. */
export function Wordmark({ height = 32 }: { height?: number }) {
  const theme = useTheme();
  const primary = theme.colors.primary;
  return (
    <Svg
      accessibilityRole="image"
      accessibilityLabel="Wayfare"
      width={(WORDMARK_BOX.width / WORDMARK_BOX.height) * height}
      height={height}
      viewBox={`0 0 ${WORDMARK_BOX.width} ${WORDMARK_BOX.height}`}
    >
      <Path d={WORDMARK_PATHS.pin} fill={primary} />
      <Path d={WORDMARK_PATHS.voice} fill={theme.colors['map-marker-selected']} />
      <Path d={WORDMARK_PATHS.wave1} stroke={primary} strokeWidth={2.93333} strokeLinecap="round" />
      <Path d={WORDMARK_PATHS.wave2} stroke={primary} strokeWidth={2.93333} strokeLinecap="round" />
      <Path d={WORDMARK_PATHS.word} fill={primary} />
    </Svg>
  );
}
