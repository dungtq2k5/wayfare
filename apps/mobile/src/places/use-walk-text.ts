import { useTourist } from '../i18n/use-tourist';
import { formatDistance, splitWalk } from './format-distance';

/** "350 m · 5 min walk", or "16.5 km · 4 h 46 min walk" once the walk is an hour or more. */
export function useDistanceText(): (distanceM: number, walkingMinutes: number) => string {
  const { t } = useTourist();
  return (distanceM, walkingMinutes) => {
    const walk =
      walkingMinutes < 60
        ? t('place.distance', { minutes: walkingMinutes })
        : t('place.distanceHours', splitWalk(walkingMinutes));
    return `${formatDistance(distanceM)} · ${walk}`;
  };
}
