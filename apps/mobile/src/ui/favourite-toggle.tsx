import { space } from '@wayfare/design-tokens/tokens';
import { CloudOff, Heart, LoaderCircle } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useFavourites, useToggleFavourite } from '../favorites/use-favorites';
import { useTourist } from '../i18n/use-tourist';
import { Icon } from '../theme/icon';

/** Where the offline mark sits in the 48 dp button: its bottom-right corner (round 25). */
const MARK_OFFSET = space[6] + space[1];

/**
 * The heart (round 25 *Favourite toggle*): outlined when off, **filled in the brand green** when
 * saved, a spinner while the change is on its way, muted with a small offline mark when there is no
 * connection (a tap says why). `floating` sits on a card circle, over a photo.
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
      accessibilityRole="switch"
      accessibilityLabel={t('favorites.save')}
      accessibilityHint={offline ? t('favorites.offlineHint') : undefined}
      accessibilityState={{ checked: saved, disabled: saving }}
      onPress={() => toggle(placeId, saved)}
      className={`min-h-target min-w-target items-center justify-center rounded-full ${
        floating ? 'bg-card elevation-2' : ''
      }`}
    >
      {saving ? (
        <Icon icon={LoaderCircle} size={24} color="muted-foreground" />
      ) : (
        <Icon
          icon={Heart}
          size={24}
          filled={saved && !offline}
          color={offline ? 'muted-foreground' : saved ? 'primary' : 'foreground'}
        />
      )}
      {offline && !saving && (
        <View
          style={{ left: MARK_OFFSET, top: MARK_OFFSET }}
          className="absolute h-5 w-5 items-center justify-center rounded-full bg-offline"
        >
          <Icon icon={CloudOff} size={12} color="offline-foreground" />
        </View>
      )}
    </Pressable>
  );
}
