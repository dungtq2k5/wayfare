import { Text, View } from 'react-native';
import { useTourist } from '../i18n/use-tourist';

/** A drawing of Android's location page, for reference only: the first option is the one to choose. */
export function AndroidOptions() {
  const { t } = useTourist();
  const options = [
    t('walk.android.always'),
    t('walk.android.whileUsing'),
    t('walk.android.ask'),
    t('walk.android.deny'),
  ];
  return (
    <View
      accessible
      accessibilityLabel={`${t('walk.step.choose')}: ${options[0]}`}
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      {options.map((option, index) => (
        <View
          key={option}
          className={`min-h-12 flex-row items-center gap-3 px-3 ${index === 0 ? 'bg-secondary' : ''}`}
        >
          <View
            className={`h-5 w-5 rounded-full border-2 ${index === 0 ? 'border-primary bg-primary' : 'border-muted-foreground'}`}
          />
          <Text
            className={`flex-1 text-body ${index === 0 ? 'text-body-strong text-primary' : 'text-muted-foreground'}`}
          >
            {option}
          </Text>
          {index === 0 && (
            <Text className="text-caption text-primary">{t('walk.step.choose')}</Text>
          )}
        </View>
      ))}
    </View>
  );
}
