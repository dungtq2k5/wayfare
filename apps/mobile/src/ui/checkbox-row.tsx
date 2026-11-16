import { Check, CircleAlert } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import { Icon } from '../theme/icon';

/** The checkbox row (round 31, the terms): the whole row is the target; an error sits under it. */
export function CheckboxRow({
  label,
  checked,
  onChange,
  error,
  testID,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string | null;
  testID?: string;
}) {
  const failed = error !== undefined && error !== null;
  return (
    <View className="gap-1">
      <Pressable
        testID={testID}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={label}
        onPress={() => onChange(!checked)}
        className="min-h-12 flex-row items-start gap-3 py-2"
      >
        <View
          className={`h-6 w-6 items-center justify-center rounded-sm border-2 ${
            checked
              ? 'border-primary bg-primary'
              : failed
                ? 'border-destructive bg-card'
                : 'border-border bg-card'
          }`}
        >
          {checked && <Icon icon={Check} size="sm" color="primary-foreground" />}
        </View>
        <Text className="flex-1 text-body text-foreground">{label}</Text>
      </Pressable>
      {failed && (
        <View accessibilityLiveRegion="polite" className="flex-row items-center gap-1">
          <Icon icon={CircleAlert} size="xs" color="destructive" />
          <Text className="flex-1 text-caption text-destructive">{error}</Text>
        </View>
      )}
    </View>
  );
}
