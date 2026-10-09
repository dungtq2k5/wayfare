import { fontSize } from '@wayfare/design-tokens/tokens';
import { Text, View, useWindowDimensions } from 'react-native';
import { clock } from './use-player';

/**
 * The widest digit of the numeric text style (Be Vietnam Pro Medium's `4`), in em. The font has no
 * tabular figures — its `1` is half as wide as its `4` — so each digit sits in a cell this wide.
 */
const DIGIT_EM = 0.72;

/**
 * A time like `1:12` whose width never changes as the digits do: every digit in a cell of the
 * same width, so `1:11` and `4:44` take the same room and nothing beside it moves. `padTo` is the
 * length of the longest text it will show (the duration's), so `0:06` and `12:06` line up too.
 * `maxScale` is the text-scale cap of the Text around it, when it has one.
 */
export function ClockText({
  ms,
  padTo,
  maxScale,
  className,
}: {
  ms: number;
  padTo?: number;
  maxScale?: number;
  className: string;
}) {
  const { fontScale } = useWindowDimensions();
  const scale = maxScale === undefined ? fontScale : Math.min(fontScale, maxScale);
  const cell = Math.ceil(fontSize.sm.size * scale * DIGIT_EM);
  const text = clock(ms);
  const blanks = Math.max(0, (padTo ?? 0) - text.length);
  return (
    <View
      accessible
      accessibilityLabel={text}
      importantForAccessibility="yes"
      className="flex-row items-center"
    >
      {Array.from({ length: blanks }, (_, index) => (
        <View key={`blank-${index}`} style={{ width: cell }} />
      ))}
      {[...text].map((char, index) =>
        char === ':' ? (
          <Text
            key={index}
            importantForAccessibility="no"
            maxFontSizeMultiplier={maxScale}
            className={className}
          >
            :
          </Text>
        ) : (
          <View key={index} style={{ width: cell }} className="items-center">
            <Text
              importantForAccessibility="no"
              maxFontSizeMultiplier={maxScale}
              className={className}
            >
              {char}
            </Text>
          </View>
        ),
      )}
    </View>
  );
}
