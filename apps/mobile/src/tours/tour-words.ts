import type { useTourist } from '../i18n/use-tourist';

type T = ReturnType<typeof useTourist>['t'];

/** A tour's time on its card: "45 min", "2 h", "1 h 15". */
export function tourTime(t: T, minutes: number): string {
  if (minutes < 60) return t('tours.minutes', { m: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? t('tours.hours', { h }) : t('tours.hoursMinutes', { h, m });
}

/** "About 2 h" on a tour's page: hours to the half, under an hour its minutes. */
export function aboutTime(t: T, minutes: number): string {
  return minutes < 60
    ? t('tour.aboutMinutes', { m: minutes })
    : t('tour.about', { h: Math.max(0.5, Math.round(minutes / 30) / 2) });
}

/** How long a finished tour took (TM4b): "1 h 48 min", or "48 min". */
export function durationText(t: T, ms: number): string {
  const total = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h === 0 ? t('tour.durationMinutes', { m }) : t('tour.duration', { h, m });
}
