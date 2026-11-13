import { CircleAlert, Eye, EyeOff } from 'lucide-react-native';
import { useState } from 'react';
import type { ComponentProps } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTheme } from '../theme/appearance';
import { Icon } from '../theme/icon';

type InputProps = ComponentProps<typeof TextInput>;

interface FieldBase {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  /** Said under the field until an error replaces it. */
  helper?: string;
  /** Said under the field, with an icon, keeping what was typed (handoff: errors beside fields). */
  error?: string | null;
  /** `Show password` / `Hide password`, for a secure field. */
  showLabel?: string;
  hideLabel?: string;
  autoComplete?: InputProps['autoComplete'];
  keyboardType?: InputProps['keyboardType'];
  autoCapitalize?: InputProps['autoCapitalize'];
  editable?: boolean;
  testID?: string;
  onSubmitEditing?: () => void;
}

/**
 * Every text field shows an example of what goes in it, never its label or help (conventions §12.5):
 * a field names one, or `null` where an example would mislead (a typed confirmation). A password has
 * none.
 */
type TextFieldProps = FieldBase &
  (
    | {
        /** A password: hidden, with *Show* / *Hide* (handoff: one field, never typed twice). */
        secure: true;
        placeholder?: undefined;
      }
    | { secure?: false; placeholder: string | null }
  );

/**
 * The text field and the password field (round 31): a label, a 48 dp field, and a helper or an
 * error under it. Paste is allowed and the system's password manager is welcome (`autoComplete`).
 */
export function TextField({
  label,
  value,
  onChangeText,
  helper,
  error,
  secure = false,
  showLabel,
  hideLabel,
  autoComplete,
  keyboardType,
  autoCapitalize = 'none',
  placeholder,
  editable = true,
  testID,
  onSubmitEditing,
}: TextFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);
  const failed = error !== undefined && error !== null;
  const edge = failed ? 'border-destructive' : focused ? 'border-primary' : 'border-border';
  return (
    <View className="gap-1">
      <Text className="text-label text-foreground">{label}</Text>
      <View
        className={`min-h-12 flex-row items-center rounded-lg border bg-card ${edge} ${
          focused || failed ? 'border-2' : ''
        }`}
      >
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onSubmitEditing}
          secureTextEntry={secure && !shown}
          autoComplete={autoComplete}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          spellCheck={false}
          editable={editable}
          placeholder={placeholder ?? undefined}
          placeholderTextColor={theme.colors['muted-foreground']}
          className="min-h-12 flex-1 px-4 text-body text-foreground"
        />
        {secure && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={shown ? hideLabel : showLabel}
            onPress={() => setShown((now) => !now)}
            className="min-h-target min-w-target items-center justify-center"
          >
            <Icon icon={shown ? EyeOff : Eye} size="md" color="muted-foreground" />
          </Pressable>
        )}
      </View>
      {failed ? (
        <View accessibilityLiveRegion="polite" className="flex-row items-center gap-1">
          <Icon icon={CircleAlert} size="xs" color="destructive" />
          <Text className="flex-1 text-caption text-destructive">{error}</Text>
        </View>
      ) : (
        helper !== undefined && <Text className="text-caption text-muted-foreground">{helper}</Text>
      )}
    </View>
  );
}
