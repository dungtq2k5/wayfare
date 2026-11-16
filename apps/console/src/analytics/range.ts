import { ANALYTICS_RANGE_MAX_DAYS, businessDay } from '@wayfare/contracts';

/** A dashboard's range: a quick one ending yesterday, or two days chosen. */
export type Range =
  | { readonly kind: 'quick'; readonly days: QuickDays }
  | { readonly kind: 'custom'; readonly from: string; readonly to: string };

export const QUICK_DAYS = [7, 30, 90] as const;
export type QuickDays = (typeof QUICK_DAYS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A business day `n` days after another (negative: before). */
export function addDays(day: string, n: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/** How many days a range covers, both ends included. */
export const daysIn = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

/**
 * The days a range asks for. A quick range ends **yesterday in Vietnam** — the last day the
 * nightly count can have finished — and starts `days − 1` before.
 */
export function rangeDays(range: Range, now: Date): { from: string; to: string } {
  if (range.kind === 'custom') return { from: range.from, to: range.to };
  const to = addDays(businessDay(now), -1);
  return { from: addDays(to, -(range.days - 1)), to };
}

/** What is wrong with two days chosen, before anything is asked: the order, or over 93 days. */
export function customProblem(from: string, to: string): 'order' | 'tooLong' | null {
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) return 'order';
  if (from > to) return 'order';
  return daysIn(from, to) > ANALYTICS_RANGE_MAX_DAYS ? 'tooLong' : null;
}

/** The range an address holds (`?range=30` or `?from=&to=`); 30 days when it holds none. */
export function parseRange(params: URLSearchParams): Range {
  const from = params.get('from');
  const to = params.get('to');
  if (from !== null && to !== null && customProblem(from, to) === null)
    return { kind: 'custom', from, to };
  const days = Number(params.get('range'));
  return { kind: 'quick', days: QUICK_DAYS.find((quick) => quick === days) ?? 30 };
}

/** The address's query for a range, other parameters kept. */
export function rangeQuery(params: URLSearchParams, range: Range): string {
  const next = new URLSearchParams(params);
  next.delete('range');
  next.delete('from');
  next.delete('to');
  if (range.kind === 'quick') next.set('range', String(range.days));
  else {
    next.set('from', range.from);
    next.set('to', range.to);
  }
  return next.toString();
}
