import { normalizeLang } from '@wayfare/contracts';
import type { Language } from '@wayfare/contracts';
import { Redirect, useRouter } from 'expo-router';
import { getLocales } from 'expo-localization';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTourist } from '../../src/i18n/use-tourist';
import { LANGUAGE_NAMES } from '../../src/i18n/languages';
import { useAppStore } from '../../src/state/app-store';
import { Button } from '../../src/ui/button';
import { LanguageList } from '../../src/ui/language-list';
import { Wordmark } from '../../src/ui/wordmark';

/** The phone's own language, when Wayfare serves it. */
function suggestedLanguage(): Language {
  const tag = getLocales()[0]?.languageTag;
  return (tag === undefined ? null : normalizeLang(tag)) ?? 'en';
}

/** First run, step one: the language (product J1). Reached with no language chosen. */
export default function LanguageScreen() {
  const { t } = useTourist();
  const router = useRouter();
  const stored = useAppStore((state) => state.language);
  const setLanguage = useAppStore((state) => state.setLanguage);
  const [suggested] = useState(suggestedLanguage);
  const [choice, setChoice] = useState(suggested);
  if (stored !== null) return <Redirect href="/privacy" />;
  const name = LANGUAGE_NAMES[choice];
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerClassName="gap-6 p-6">
        <Wordmark />
        <View className="gap-2">
          <Text accessibilityRole="header" className="text-title text-foreground">
            {t('firstRun.language.title')}
          </Text>
          <Text className="text-body text-muted-foreground">{t('firstRun.language.subtitle')}</Text>
        </View>
        <LanguageList value={choice} suggested={suggested} onChange={setChoice} />
      </ScrollView>
      <View className="p-6">
        <Button
          label={t('firstRun.language.continue', { language: name })}
          onPress={() => {
            setLanguage(choice);
            router.push('/privacy');
          }}
        />
      </View>
    </SafeAreaView>
  );
}
