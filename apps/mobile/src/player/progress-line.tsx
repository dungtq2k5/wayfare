import { View } from 'react-native';

/** The progress line's thickness, in dp (round 26: 3). */
const LINE = 3;

/** A thin elapsed line: the accent over a faint track. `fraction` is 0–1. */
export function ProgressLine({ fraction }: { fraction: number }) {
  return (
    <View style={{ height: LINE }} className="w-full overflow-hidden rounded-full">
      <View className="absolute inset-0 bg-now-playing-foreground/25" />
      <View
        style={{ width: `${Math.min(1, Math.max(0, fraction)) * 100}%`, height: LINE }}
        className="bg-now-playing-accent"
      />
    </View>
  );
}
