import { useDevicesUpdate } from '@wayfare/api-client';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage } from '../../src/i18n';
import { useTourist } from '../../src/i18n/use-tourist';
import { useAppStore } from '../../src/state/app-store';
import { LIST_END_PADDING } from '../../src/ui/layout';
import { LanguageList } from '../../src/ui/language-list';
import { ScreenHeader } from '../../src/ui/screen-header';

/** Settings › Language: the picker, one level down. The device's content language follows. */
export default function LanguageSettingsScreen() {
  const { t } = useTourist();
  const language = useAppStore((state) => state.language);
  const [failure, setFailure] = useState<string | null>(null);
  const update = useDevicesUpdate({
    mutation: { onError: (error) => setFailure(errorMessage(error)) },
  });
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title={t('settings.language')} type="back" />
      <ScrollView contentContainerStyle={{ paddingBottom: LIST_END_PADDING }}>
        <View className="gap-4 px-4">
          <LanguageList
            value={language}
            onChange={(selected) => {
              setFailure(null);
              useAppStore.getState().setLanguage(selected);
              update.mutate({ data: { contentLocale: selected } });
            }}
          />
          {failure !== null && (
            <Text accessibilityRole="alert" className="text-body text-destructive">
              {failure}
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
