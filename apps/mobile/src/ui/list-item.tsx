import type { LucideIcon } from 'lucide-react-native';
import { CheckCircle2, ChevronRight } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Icon } from '../theme/icon';

interface ListItemProps {
  title: string;
  subtitle?: string;
  leading?: LucideIcon;
  /** Chosen: accent surface, primary edge, a check. */
  selected?: boolean;
  /** A forward arrow, for a row that opens something. */
  chevron?: boolean;
  onPress: () => void;
  children?: ReactNode;
}

/** The language list item and its kin: at least 48 dp tall, and taller when the text wraps. */
export function ListItem({ title, subtitle, leading, selected, chevron, onPress }: ListItemProps) {
  return (
    <Pressable
      accessibilityRole={selected === undefined ? 'button' : 'radio'}
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress}
      className={`min-h-12 flex-row items-center gap-3 rounded-lg px-4 py-3 ${
        selected === true ? 'border-2 border-primary bg-accent' : 'border border-border bg-card'
      }`}
    >
      {leading !== undefined && <Icon icon={leading} size={24} color="muted-foreground" />}
      <View className="flex-1">
        <Text className="text-body-strong text-foreground">{title}</Text>
        {subtitle !== undefined && (
          <Text numberOfLines={1} className="text-caption text-muted-foreground">
            {subtitle}
          </Text>
        )}
      </View>
      {selected === true && <Icon icon={CheckCircle2} size={24} color="primary" />}
      {chevron === true && <Icon icon={ChevronRight} size={20} color="muted-foreground" />}
    </Pressable>
  );
}
