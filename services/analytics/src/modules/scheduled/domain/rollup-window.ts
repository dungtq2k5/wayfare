import { businessDay, RAW_EVENT_RETENTION_DAYS } from '@wayfare/contracts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many days before yesterday the nightly rebuild also covers: a phone uploads a week late. */
export const REBUILD_EXTRA_DAYS = 7;

/** The business day `n` days before `day`. */
export const daysBefore = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10);

/** The days the nightly rebuild covers at `now`: yesterday and the 7 before it, oldest first. */
export function rebuildWindow(now: Date): string[] {
  const yesterday = daysBefore(businessDay(now), 1);
  return Array.from({ length: REBUILD_EXTRA_DAYS + 1 }, (_, index) =>
    daysBefore(yesterday, REBUILD_EXTRA_DAYS - index),
  );
}

/**
 * Whether a day can still be rebuilt at `now`: its raw events are kept 90 days (rdm-spec A-4), so
 * an older day would be rebuilt from nothing — refused, never silently zeroed. Today isn't over.
 */
export function rebuildable(day: string, now: Date): boolean {
  const today = businessDay(now);
  return day < today && day >= daysBefore(today, RAW_EVENT_RETENTION_DAYS);
}
