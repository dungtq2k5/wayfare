import { useRouter } from 'expo-router';
import { ChevronRight, Footprints, TriangleAlert } from 'lucide-react-native';
import { Pressable, Text } from 'react-native';
import { useTourist } from '../i18n/use-tourist';
import { Icon } from '../theme/icon';
import { problemOf, useWalkStore } from './store';

/** Beside a tab's large title while a walk is on: "Walking · 3 heard", opening the Map (W8). */
export function WalkChip() {
  const { t } = useTourist();
  const router = useRouter();
  const phase = useWalkStore((state) => state.walk.phase);
  const heard = useWalkStore((state) => state.walk.heard.length);
  const problem = problemOf(useWalkStore());
  if (phase !== 'on' && phase !== 'foreground-only') return null;
  const text =
    problem === 'location-off'
      ? t('walk.chip.locationOff')
      : problem === 'weak-gps'
        ? t('walk.chip.weakGps')
        : problem === 'no-position'
          ? t('walk.chip.noPosition')
          : t('walk.chip.on', { count: heard });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${text}. ${t('walk.chip.label')}`}
      onPress={() => router.navigate('/map')}
      className="min-h-11 flex-row items-center gap-1 rounded-full bg-secondary px-3"
    >
      <Icon
        icon={problem === null ? Footprints : TriangleAlert}
        size="sm"
        color={problem === null ? 'primary' : 'warning-foreground'}
      />
      <Text className="shrink text-label text-secondary-foreground">{text}</Text>
      <Icon icon={ChevronRight} size="sm" color="muted-foreground" />
    </Pressable>
  );
}
