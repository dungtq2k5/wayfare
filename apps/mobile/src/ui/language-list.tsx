import { useState } from 'react';
import { View } from 'react-native';
import { LANGUAGE_NAMES, OTHER_LANGUAGES, TOP_LANGUAGES } from '../i18n/languages';
import { Button } from './button';
import { useTourist } from '../i18n/use-tourist';

/** The five launch languages, and *Other* for the rest — each in its own name. */
export function LanguageList({
  current,
  onSelect,
}: {
  current: string | null;
  onSelect: (language: string) => void;
}): React.JSX.Element {
  const { t } = useTourist();
  const [other, setOther] = useState(false);
  const languages = other ? [...TOP_LANGUAGES, ...OTHER_LANGUAGES] : TOP_LANGUAGES;
  return (
    <View className="gap-3">
      {languages.map((language) => (
        <Button
          key={language}
          label={LANGUAGE_NAMES[language]}
          variant={language === current ? 'primary' : 'secondary'}
          onPress={() => onSelect(language)}
        />
      ))}
      {!other && (
        <Button
          label={t('firstRun.language.other')}
          variant="secondary"
          onPress={() => setOther(true)}
        />
      )}
    </View>
  );
}
