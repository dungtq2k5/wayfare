import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTourist } from '../../src/i18n/use-tourist';
import { ScreenHeader } from '../../src/ui/screen-header';

/** What the map credits (ODbL requires it): reached from the map's attribution. */
export default function CreditsScreen() {
  const { t } = useTourist();
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title={t('settings.credits')} type="back" />
      <ScrollView contentContainerClassName="gap-4 px-4">
        <View className="gap-2">
          <Text className="text-body text-foreground">{t('settings.credits.map')}</Text>
          <Text className="text-body text-foreground">{t('settings.credits.fonts')}</Text>
          <Text className="text-body text-foreground">{t('settings.credits.icons')}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
