import { CloudOff, Heart } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useFavourites, useToggleFavourite } from '../favorites/use-favorites';
import { useTourist } from '../i18n/use-tourist';
import { Icon } from '../theme/icon';

/**
 * The heart. Saved is filled; offline it is muted with a small offline mark and a tap says why
 * ; `floating` sits on a card circle, over a photo.
 */
export function FavouriteToggle({
  placeId,
  floating = false,
}: {
  placeId: string;
  floating?: boolean;
}) {
  const { t } = useTourist();
  const { ids } = useFavourites();
  const { toggle, saving, offline } = useToggleFavourite();
  const saved = ids.has(placeId);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={saved ? t('favorites.unsave') : t('favorites.save')}
      accessibilityState={{ selected: saved, disabled: saving }}
      onPress={() => toggle(placeId, saved)}
      className={`min-h-target min-w-target items-center justify-center rounded-full ${
        floating ? 'bg-card elevation-1' : ''
      } ${offline || saving ? 'opacity-60' : ''}`}
    >
      <View>
        <Icon icon={Heart} size={24} color={saved ? 'destructive' : 'foreground'} />
        {offline && (
          <View className="absolute -bottom-1 -right-1 rounded-full bg-card">
            <Icon icon={CloudOff} size={16} color="muted-foreground" />
          </View>
        )}
      </View>
    </Pressable>
  );
}
