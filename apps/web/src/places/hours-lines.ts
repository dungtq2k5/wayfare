import { businessClock } from '@wayfare/core';
import type { OpeningHoursRowInput } from '@wayfare/core';

/** One line of the week: the ranges that day, or none ("closed" says so; no row says nothing). */
export interface WeekdayLine {
  readonly weekday: number;
  /** `08:00–22:00` each; empty when closed or unlisted. */
  readonly ranges: readonly string[];
  readonly closed: boolean;
  readonly today: boolean;
}

/** An exception day, with the same ranges. */
export interface SpecialLine {
  readonly date: string;
  readonly ranges: readonly string[];
  readonly closed: boolean;
  readonly today: boolean;
}

const range = (row: OpeningHoursRowInput) => `${row.opensAt ?? ''}–${row.closesAt ?? ''}`;

/**
 * The hours as the detail shows them: the week with today marked, then any special dates from today
 * on. Both are in the business time zone.
 */
export function hoursLines(
  rows: readonly OpeningHoursRowInput[],
  now: number,
): { week: WeekdayLine[]; specials: SpecialLine[] } {
  const today = businessClock(now);
  const week = [1, 2, 3, 4, 5, 6, 7].map((weekday): WeekdayLine => {
    const forDay = rows.filter((row) => row.weekday === weekday);
    const open = forDay.filter((row) => row.isClosed !== true);
    return {
      weekday,
      ranges: open.map(range),
      closed: forDay.length > 0 && open.length === 0,
      today: weekday === today.weekday,
    };
  });
  const dates = [
    ...new Set(rows.flatMap((row) => (row.specificDate === undefined ? [] : [row.specificDate]))),
  ]
    .filter((date) => date >= today.date)
    .sort((a, b) => (a < b ? -1 : 1));
  const specials = dates.map((date): SpecialLine => {
    const forDate = rows.filter((row) => row.specificDate === date);
    const open = forDate.filter((row) => row.isClosed !== true);
    return { date, ranges: open.map(range), closed: open.length === 0, today: date === today.date };
  });
  return { week, specials };
}
