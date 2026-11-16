import { Text, View } from 'react-native';
import { useTourist } from '../i18n/use-tourist';
import { Button } from './button';

/** A read that failed, said where its answer would be, with *Try again* (K1). */
export function InlineAlert({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTourist();
  return (
    <View className="gap-3">
      <Text accessibilityRole="alert" className="text-body text-destructive">
        {message}
      </Text>
      <Button label={t('action.retry')} onPress={onRetry} />
    </View>
  );
}
