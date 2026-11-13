import { LoaderCircle } from 'lucide-react-native';
import { Image, Pressable, Text, View } from 'react-native';
import { Icon } from '../theme/icon';

import GOOGLE_G from '../../assets/brand/google-g.png';

/** Google's four-colour *G* — an asset, as Google publishes it, never recoloured (`221:129`). */
export function GoogleG({ size = 20 }: { size?: number }) {
  return (
    <Image
      source={GOOGLE_G}
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

/**
 * *Continue with Google* (round 31a, `221:153`): Google's neutral button — its colours, the *G*,
 * the label in Roboto Medium (the system's) — at Wayfare's 48 dp and corners. While the server
 * answers, a spinner takes the *G*'s place and the label stays; a second tap does nothing.
 */
export function GoogleButton({
  label,
  busyLabel,
  onPress,
  loading = false,
  disabled = false,
  testID,
}: {
  label: string;
  /** Said by a screen reader while waiting: "Signing in with Google". */
  busyLabel: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={loading ? busyLabel : label}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      className={`min-h-12 flex-row items-center justify-center gap-3 rounded-lg border border-google-button-border bg-google-button px-4 py-3 ${disabled ? 'opacity-45' : ''}`}
    >
      <View className="h-5 w-5 items-center justify-center">
        {loading ? (
          <Icon icon={LoaderCircle} size="md" color="google-button-foreground" />
        ) : (
          <GoogleG />
        )}
      </View>
      <Text
        numberOfLines={1}
        // Google's branding sets the label in Roboto Medium, the system font — no Wayfare token.
        // eslint-disable-next-line no-restricted-syntax
        style={{ fontFamily: 'sans-serif-medium' }}
        className="text-body text-google-button-foreground"
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** The "or" between Google and the email form (`221:154`): two hairlines and a word. */
export function OrDivider({ label }: { label: string }) {
  return (
    <View className="flex-row items-center gap-3" accessibilityRole="text">
      <View className="flex-1 border-b border-border" />
      <Text className="text-label text-muted-foreground">{label}</Text>
      <View className="flex-1 border-b border-border" />
    </View>
  );
}
