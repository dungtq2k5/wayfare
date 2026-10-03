import { Redirect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppStore } from '../../src/state/app-store';
import { LanguageList } from '../../src/ui/language-list';

/** First run, step one: the language (product J1). Reached with no language chosen. */
export default function LanguageScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const language = useAppStore((state) => state.language);
  const setLanguage = useAppStore((state) => state.setLanguage);
  if (language !== null) return <Redirect href="/privacy" />;
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerClassName="gap-6 p-6">
        <Text accessibilityRole="header" className="text-3xl font-bold text-emerald-900">
          {t('firstRun.language.title')}
        </Text>
        <LanguageList
          current={null}
          onSelect={(selected) => {
            setLanguage(selected);
            router.push('/privacy');
          }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
