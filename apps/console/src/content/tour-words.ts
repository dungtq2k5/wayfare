import type { ConsoleLocale } from '../i18n/messages';

/** A distance as the tour pages write it: metres under a kilometre, then one decimal of a km. */
export function formatDistance(metres: number, locale: ConsoleLocale): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(metres / 1000);
  return `${km} km`;
}

/** A tour's time in the list: "45 min", "2 h", "1 h 15". */
export function tourTime(
  minutes: number,
  t: (
    key: 'tours.minutes' | 'tours.hours' | 'tours.hoursMinutes',
    values: Record<string, number>,
  ) => string,
): string {
  if (minutes < 60) return t('tours.minutes', { m: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? t('tours.hours', { h }) : t('tours.hoursMinutes', { h, m });
}

/** Why a tour waits, under its status (TA1): not asked yet, translating, or an admin's hold. */
export function tourWaitKey(tour: {
  readonly status: string;
  readonly activationRequested: boolean;
  readonly inactiveByAdmin: boolean;
}): 'tours.notRequested' | 'tours.translating' | 'tours.hiddenByAdmin' | null {
  if (tour.status === 'DRAFT' && !tour.activationRequested) return 'tours.notRequested';
  if (tour.status === 'PROCESSING') return 'tours.translating';
  if (tour.status === 'INACTIVE' && tour.inactiveByAdmin) return 'tours.hiddenByAdmin';
  return null;
}

/** "About 2 h" in a header: hours, rounded to the half, under an hour its minutes. */
export function aboutHours(minutes: number): number {
  return Math.max(0.5, Math.round(minutes / 30) / 2);
}
