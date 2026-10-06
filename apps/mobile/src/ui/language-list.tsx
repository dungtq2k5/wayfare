import { Globe } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import {
  LANGUAGE_ENGLISH_NAMES,
  LANGUAGE_NAMES,
  OTHER_LANGUAGES,
  TOP_LANGUAGES,
} from '../i18n/languages';
import { useTourist } from '../i18n/use-tourist';
import { ListItem } from './list-item';

interface LanguageListProps {
  value: string | null;
  /** The language the phone suggests; its row says so instead of naming the language in English. */
  suggested?: string | null;
  onChange: (language: string) => void;
}

/** The five launch languages, and *Other languages* for the rest — each in its own name. */
export function LanguageList({ value, suggested = null, onChange }: LanguageListProps) {
  const { t } = useTourist();
  const [other, setOther] = useState(false);
  const row = (language: (typeof TOP_LANGUAGES)[number]) => (
    <ListItem
      key={language}
      title={LANGUAGE_NAMES[language]}
      subtitle={
        language === suggested ? t('firstRun.language.suggested') : LANGUAGE_ENGLISH_NAMES[language]
      }
      selected={language === value}
      onPress={() => onChange(language)}
    />
  );
  return (
    <View className="gap-2">
      {[...TOP_LANGUAGES]
        .sort((a, b) => Number(b === suggested) - Number(a === suggested))
        .map(row)}
      {other ? (
        OTHER_LANGUAGES.map(row)
      ) : (
        <ListItem
          leading={Globe}
          title={t('firstRun.language.other')}
          subtitle={OTHER_LANGUAGES.map((language) => LANGUAGE_NAMES[language]).join(', ')}
          chevron
          onPress={() => setOther(true)}
        />
      )}
    </View>
  );
}
