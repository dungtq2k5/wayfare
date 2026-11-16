import type { LucideIcon } from 'lucide-react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../theme/icon';
import { Button } from './button';
import { LogoMark } from './logo-mark';
import { ILLUSTRATION_DISC } from './layout';

export interface ExplainerContent {
  title: string;
  body: string;
  bullets: { icon: LucideIcon; text: string }[];
  primary: string;
  secondary: string;
  footnote?: string;
}

/**
 * The full-screen explainer before a system permission, and after a refusal: the mark, what the
 * permission is for and what it is not, the main step and a quiet way around it.
 */
export function PermissionExplainer({
  content,
  onPrimary,
  onSecondary,
}: {
  content: ExplainerContent;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerClassName="grow gap-6 px-6 pt-16">
        <View className="items-center">
          <View
            style={{ width: ILLUSTRATION_DISC, height: ILLUSTRATION_DISC }}
            className="items-center justify-center rounded-full bg-accent"
          >
            <LogoMark size={96} />
          </View>
        </View>
        <Text accessibilityRole="header" className="text-display text-foreground">
          {content.title}
        </Text>
        <Text className="text-body text-muted-foreground">{content.body}</Text>
        <View className="gap-4">
          {content.bullets.map((bullet) => (
            <View key={bullet.text} className="flex-row items-center gap-3">
              <Icon icon={bullet.icon} size="lg" color="muted-foreground" />
              <Text className="flex-1 text-body text-foreground">{bullet.text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
      <View className="gap-2 px-6 pb-8">
        <Button label={content.primary} onPress={onPrimary} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={content.secondary}
          onPress={onSecondary}
          className="min-h-12 items-center justify-center"
        >
          <Text className="text-label text-primary">{content.secondary}</Text>
        </Pressable>
        {content.footnote !== undefined && (
          <Text className="text-center text-caption text-muted-foreground">{content.footnote}</Text>
        )}
      </View>
    </SafeAreaView>
  );
}
