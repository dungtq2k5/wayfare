/** The log's widest read (api §1.8). */
export const MAX_AUDIT_DAYS = 93;
/** The range the log opens on: the last 7 days, today included (the product owner, K22). */
const DEFAULT_DAYS = 7;
const DAY_MS = 86_400_000;

/** A local calendar day as a date field holds it: `YYYY-MM-DD`. */
const dayOf = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** The last 7 days, today included. */
export const defaultDays = (now = new Date()) => ({
  from: dayOf(new Date(now.getTime() - (DEFAULT_DAYS - 1) * DAY_MS)),
  to: dayOf(now),
});

/** The request's instants for two days: the start of the first, the end of the last (local). */
export const dayRange = (from: string, to: string) => ({
  from: new Date(`${from}T00:00:00`).toISOString(),
  to: new Date(`${to}T23:59:59.999`).toISOString(),
});

/** What is wrong with a range (H1b), checked before asking: backwards, or over 93 days. */
export function rangeError(from: string, to: string): 'backwards' | 'tooLong' | null {
  const { from: start, to: end } = dayRange(from, to);
  const span = Date.parse(end) - Date.parse(start);
  if (Number.isNaN(span) || span < 0) return 'backwards';
  return span > MAX_AUDIT_DAYS * DAY_MS ? 'tooLong' : null;
}
