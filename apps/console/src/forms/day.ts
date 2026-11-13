const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A typed day → `yyyy-mm-dd`, or null. Day, month, year in both languages ("30 Oct 2026",
 * "30 thg 10, 2026", "30/10/2026"), or the ISO order; never the browser's month-first.
 */
export function parseDay(text: string): string | null {
  const parts = text.toLowerCase().match(/\d+|[a-z]+/g) ?? [];
  const numbers = parts.filter((part) => /^\d+$/.test(part)).map(Number);
  const named = parts
    .map((part) => MONTHS.indexOf(part.slice(0, 3)) + 1)
    .find((month) => month > 0);
  let day: number | undefined;
  let month: number | undefined;
  let year: number | undefined;
  if (named !== undefined && numbers.length === 2)
    [day, year, month] = [numbers[0], numbers[1], named];
  else if (numbers.length === 3 && numbers[0]! > 999) [year, month, day] = numbers;
  else if (numbers.length === 3) [day, month, year] = numbers;
  if (day === undefined || month === undefined || year === undefined || year < 1000) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}
