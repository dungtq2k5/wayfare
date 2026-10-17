import { CloudOff } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LANGUAGE_NAMES } from '../../src/i18n/languages';
import { switchTo, useSwitchStore } from '../../src/language/switch';
import { useTourist } from '../../src/i18n/use-tourist';
import { useNetworkStore } from '../../src/network/network-store';
import { useAppStore } from '../../src/state/app-store';
import { InlineNote } from '../../src/ui/inline-note';
import { LIST_END_PADDING } from '../../src/ui/layout';
import { LanguageList } from '../../src/ui/language-list';
import { ScreenHeader } from '../../src/ui/screen-header';
import { SwitchCard } from '../../src/language/switch-status';

/**
 * Settings › Language: the picker, one level down, with the switch under way on top. Nothing
 * changes until the new language is ready; the device's content language follows the switch.
 */
export default function LanguageSettingsScreen() {
  const { t } = useTourist();
  const language = useAppStore((state) => state.language);
  const pending = useAppStore((state) => state.pendingLanguage);
  const phase = useSwitchStore((state) => state.phase);
  const offline = useNetworkStore((state) => state.status === 'offline');
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScreenHeader title={t('settings.language')} type="back" />
      <ScrollView contentContainerStyle={{ paddingBottom: LIST_END_PADDING }}>
        <View className="gap-2 px-4">
          {offline && pending === null && language !== null && (
            <InlineNote
              icon={CloudOff}
              text={t('switch.offlineNote', { lang: LANGUAGE_NAMES[language] })}
            />
          )}
          <SwitchCard />
          <LanguageList
            value={language}
            switching={
              // A failed switch is not under way: the card says so, and the row is plain again.
              pending === null || phase === 'failed'
                ? null
                : { language: pending, offline: phase === 'offline' }
            }
            onChange={switchTo}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
