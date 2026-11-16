import type { Language } from '@wayfare/contracts';
import { Globe, LoaderCircle, WifiOff } from 'lucide-react-native';
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
  value: Language | null;
  /** The language the phone suggests; its row says so instead of naming the language in English. */
  suggested?: Language | null;
  /** The language a switch is under way to, and whether it waits for a connection. */
  switching?: { language: Language; offline: boolean } | null;
  onChange: (language: Language) => void;
}

/** The five launch languages, and *Other languages* for the rest — each in its own name. */
export function LanguageList({
  value,
  suggested = null,
  switching = null,
  onChange,
}: LanguageListProps) {
  const { t } = useTourist();
  // A long-tail language switching opens the rest of the list, so its row shows.
  const [other, setOther] = useState(
    switching !== null && OTHER_LANGUAGES.includes(switching.language),
  );
  const row = (language: (typeof TOP_LANGUAGES)[number]) => {
    const name =
      language === suggested ? t('firstRun.language.suggested') : LANGUAGE_ENGLISH_NAMES[language];
    const state = switching?.language === language ? switching : null;
    return (
      <ListItem
        key={language}
        title={LANGUAGE_NAMES[language]}
        subtitle={
          state === null
            ? name
            : state.offline
              ? t('switch.row.offline', { name })
              : t('switch.row.switching', { name })
        }
        selected={language === value}
        trailing={state === null ? undefined : state.offline ? WifiOff : LoaderCircle}
        onPress={() => onChange(language)}
      />
    );
  };
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
