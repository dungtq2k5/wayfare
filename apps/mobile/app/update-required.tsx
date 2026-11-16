import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppStore } from '../src/state/app-store';
import { useTourist } from '../src/i18n/use-tourist';

/** Shown for `426 APP_VERSION_UNSUPPORTED`: this build is below the gateway's floor. */
export default function UpdateRequiredScreen() {
  const { t } = useTourist();
  const minimumVersion = useAppStore((state) => state.updateRequired);
  return (
    <SafeAreaView className="flex-1 gap-4 bg-background p-6">
      <Text accessibilityRole="header" className="text-title text-foreground">
        {t('updateRequired.title')}
      </Text>
      <Text className="text-body text-foreground">
        {t('updateRequired.body', { minimumVersion: minimumVersion ?? '' })}
      </Text>
    </SafeAreaView>
  );
}
