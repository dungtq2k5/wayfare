/**
 * Whether a Place is open, from its opening-hours rows (rdm-spec C-16), in the business time zone.
 * Pure: it takes the instant as an argument and never reads the phone's zone, so a tourist's
 * device setting cannot change the answer (conventions §3.2).
 *
 * The pilot's one zone, `Asia/Ho_Chi_Minh`, has kept UTC+7 since 1975 and has no daylight saving,
 * so the zone is a fixed offset here: the arithmetic needs no `Intl`, which Hermes implements
 * unevenly (its plural rules were incomplete). A spec checks it against `Intl` on this Node.
 */

/** The business zone's offset from UTC, in milliseconds (`BUSINESS_TIME_ZONE`). */
export const BUSINESS_UTC_OFFSET_MS = 7 * 3_600_000;

/** "Closes soon" starts this many minutes before closing. */
export const CLOSES_SOON_MINUTES = 60;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const DAY_MINUTES = 1_440;
/** How far ahead to look for the next opening, in days. */
const LOOKAHEAD_DAYS = 8;

/** One row of `place_opening_hours` as the app holds it. */
export interface OpeningHoursRowInput {
  /** ISO weekday, 1 = Monday … 7 = Sunday; exactly one of this and `specificDate`. */
  readonly weekday?: number | undefined;
  /** An exception day, `YYYY-MM-DD`. */
  readonly specificDate?: string | undefined;
  /** `HH:MM`, local business time. */
  readonly opensAt?: string | undefined;
  /** `HH:MM`; earlier than `opensAt` means the interval ends the next day. */
  readonly closesAt?: string | undefined;
  readonly isClosed?: boolean | undefined;
}

/** The business-zone calendar at an instant. */
export interface BusinessClock {
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  readonly weekday: number;
  /** Minutes since local midnight. */
  readonly minutes: number;
}

/** Days since 1970-01-01 → `YYYY-MM-DD` (proleptic Gregorian; Howard Hinnant's civil-from-days). */
function civilDate(days: number): string {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const dayOfEra = z - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1_460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  const pad = (value: number, width: number) => String(value).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** The business-zone date, weekday and minute of day at `now` (epoch milliseconds). */
export function businessClock(now: number): BusinessClock {
  const local = now + BUSINESS_UTC_OFFSET_MS;
  const days = Math.floor(local / DAY_MS);
  return {
    date: civilDate(days),
    // 1970-01-01 was a Thursday (ISO 4).
    weekday: ((((days + 3) % 7) + 7) % 7) + 1,
    minutes: Math.floor((local - days * DAY_MS) / MINUTE_MS),
  };
}

const toMinutes = (time: string): number => {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
};

const toTime = (minutes: number): string => {
  const wrapped = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
};

/** A span of minutes since the start of an anchor day; `end` may pass 1440 (it ran past midnight). */
interface Span {
  readonly start: number;
  readonly end: number;
}

/**
 * The rows in force on a day: the specific-date rows if there are any, which replace every weekday
 * row for that date, else the weekday's rows.
 */
function rowsFor(rows: readonly OpeningHoursRowInput[], date: string, weekday: number) {
  const exceptions = rows.filter((row) => row.specificDate === date);
  return exceptions.length > 0 ? exceptions : rows.filter((row) => row.weekday === weekday);
}

/** The open spans that start on a day (an overnight one runs past 1440). */
function spansOf(rows: readonly OpeningHoursRowInput[], date: string, weekday: number): Span[] {
  return rowsFor(rows, date, weekday)
    .filter(
      (row) => row.isClosed !== true && row.opensAt !== undefined && row.closesAt !== undefined,
    )
    .map((row) => {
      const start = toMinutes(row.opensAt!);
      const close = toMinutes(row.closesAt!);
      return { start, end: close <= start ? close + DAY_MINUTES : close };
    });
}

/** A day's instants as absolute minute spans, starting `offsetDays` after the anchor day. */
function absoluteSpans(
  rows: readonly OpeningHoursRowInput[],
  anchorDays: number,
  fromDay: number,
  toDay: number,
): Span[] {
  const all: Span[] = [];
  for (let day = fromDay; day <= toDay; day += 1) {
    const date = civilDate(anchorDays + day);
    const weekday = ((((anchorDays + day + 3) % 7) + 7) % 7) + 1;
    for (const span of spansOf(rows, date, weekday)) {
      all.push({ start: day * DAY_MINUTES + span.start, end: day * DAY_MINUTES + span.end });
    }
  }
  return all.sort((a, b) => a.start - b.start);
}

/** Touching or overlapping spans become one, so 06–14 followed by 14–22 closes at 22. */
function merge(spans: readonly Span[]): Span[] {
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last !== undefined && span.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, span.end) };
    } else {
      merged.push(span);
    }
  }
  return merged;
}

/** What the card, the sheet and the detail say about a Place's hours. */
export type OpeningState =
  /** The Place lists no hours at all: never *Open now*. */
  | { readonly kind: 'not-listed' }
  | {
      readonly kind: 'open';
      /** `HH:MM`. */
      readonly closesAt: string;
      /** True within `CLOSES_SOON_MINUTES` of closing. */
      readonly closesSoon: boolean;
    }
  | {
      readonly kind: 'closed';
      /** `HH:MM`, or null when nothing opens within the next week. */
      readonly opensAt: string | null;
      /** 0 = today, 1 = tomorrow, …; null with `opensAt`. */
      readonly opensInDays: number | null;
      /** The ISO weekday of that opening, for "opens Monday at 08:00". */
      readonly opensWeekday: number | null;
    };

/** The opening state of a Place at `now` (epoch milliseconds), in the business time zone. */
export function openingState(rows: readonly OpeningHoursRowInput[], now: number): OpeningState {
  if (rows.length === 0) return { kind: 'not-listed' };
  const clock = businessClock(now);
  const anchorDays = Math.floor((now + BUSINESS_UTC_OFFSET_MS) / DAY_MS);
  // Yesterday's overnight spans reach into today; look ahead for the next opening.
  const spans = merge(absoluteSpans(rows, anchorDays, -1, LOOKAHEAD_DAYS));
  const minute = clock.minutes;
  const current = spans.find((span) => span.start <= minute && minute < span.end);
  if (current !== undefined) {
    return {
      kind: 'open',
      closesAt: toTime(current.end),
      closesSoon: current.end - minute <= CLOSES_SOON_MINUTES,
    };
  }
  const next = spans.find((span) => span.start > minute);
  if (next === undefined)
    return { kind: 'closed', opensAt: null, opensInDays: null, opensWeekday: null };
  const inDays = Math.floor(next.start / DAY_MINUTES);
  return {
    kind: 'closed',
    opensAt: toTime(next.start),
    opensInDays: inDays,
    opensWeekday: ((((anchorDays + inDays + 3) % 7) + 7) % 7) + 1,
  };
}
