import { Image } from 'expo-image';
import { cssInterop } from 'nativewind';
import { View } from 'react-native';
import { categoryIcon } from '../map/categories';
import { Icon } from '../theme/icon';

// expo-image is not a React Native view NativeWind knows: without this its `className` is dropped
// and the photo has no size.
cssInterop(Image, { className: 'style' });

/** A Place's photo, or the designed placeholder: its category's icon on a quiet surface. */
export function PlacePhoto({
  uri,
  categoryCode,
  className = 'h-16 w-16',
  label,
}: {
  uri: string | null;
  categoryCode: string;
  className?: string;
  label?: string;
}) {
  if (uri === null) {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className={`items-center justify-center rounded-lg bg-secondary ${className}`}
      >
        <Icon icon={categoryIcon(categoryCode)} size="lg" color="muted-foreground" />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      contentFit="cover"
      accessibilityLabel={label}
      accessible={label !== undefined}
      className={`rounded-lg bg-secondary ${className}`}
    />
  );
}
