const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long ago `then` was, as the unit to say it in. The words are the bundle's (`time.*`). */
export type RelativeTime =
  | { key: 'time.justNow' }
  | { key: 'time.minutesAgo' | 'time.hoursAgo' | 'time.daysAgo'; count: number };

export function relativeTime(now: number, then: number): RelativeTime {
  const elapsed = Math.max(0, now - then);
  if (elapsed < MINUTE) return { key: 'time.justNow' };
  if (elapsed < HOUR) return { key: 'time.minutesAgo', count: Math.floor(elapsed / MINUTE) };
  if (elapsed < DAY) return { key: 'time.hoursAgo', count: Math.floor(elapsed / HOUR) };
  return { key: 'time.daysAgo', count: Math.floor(elapsed / DAY) };
}
