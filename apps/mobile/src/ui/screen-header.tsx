import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTourist } from '../i18n/use-tourist';
import { Icon } from '../theme/icon';

interface ScreenHeaderProps {
  title: string;
  /** `large` on a tab; `back` on a sub-screen. */
  type?: 'large' | 'back';
  trailing?: ReactNode;
}

/**
 * The title lives in the content, never a native header bar, so it grows with the system text size
 * and wraps (handoff: header pattern).
 */
export function ScreenHeader({ title, type = 'large', trailing }: ScreenHeaderProps) {
  const router = useRouter();
  const { t } = useTourist();
  return (
    <View className="flex-row items-center gap-2 px-4 pb-2 pt-4">
      {type === 'back' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.back')}
          onPress={() => router.back()}
          className="min-h-12 min-w-12 items-center justify-center"
        >
          <Icon icon={ArrowLeft} size="lg" />
        </Pressable>
      )}
      <Text
        accessibilityRole="header"
        className={`flex-1 text-foreground ${type === 'large' ? 'text-display' : 'text-title'}`}
      >
        {title}
      </Text>
      {trailing}
    </View>
  );
}
