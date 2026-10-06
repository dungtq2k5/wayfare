import type { ReactNode } from 'react';
import { View } from 'react-native';

/** A surface: card colour, a hairline border, elevation 1. It grows with its content. */
export function Card({ children }: { children: ReactNode }) {
  return (
    <View className="gap-3 rounded-xl border border-border bg-card p-4 elevation-1">
      {children}
    </View>
  );
}
