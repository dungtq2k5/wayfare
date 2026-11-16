/** A dish's price as the venue set it (ADR 0046): đồng in Vietnam's form, dollars in theirs. */
export function price(priceMinor: number, currency: string, locale: string): string {
  if (currency === 'VND') return `${new Intl.NumberFormat('vi-VN').format(priceMinor)} ₫`;
  return new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
    style: 'currency',
    currency,
  }).format(priceMinor / 100);
}

/** A distance: whole metres under 1 km, then kilometres to one decimal, in the page's numbers. */
export function distance(metres: number, locale: string): { unit: 'm' | 'km'; n: string } {
  if (metres < 1000) return { unit: 'm', n: String(Math.round(metres / 10) * 10 || metres) };
  return {
    unit: 'km',
    n: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(metres / 1000),
  };
}

/** A code as printed on the sticker: two groups of four. */
export function printedCode(code: string): string {
  const plain = code.replaceAll('-', '').toUpperCase();
  return `${plain.slice(0, 4)} ${plain.slice(4)}`;
}

/** The code in its link form, `Z63T-CMMT`. */
export function linkCode(code: string): string {
  const plain = code.replaceAll('-', '').toUpperCase();
  return `${plain.slice(0, 4)}-${plain.slice(4)}`;
}

/** ISO weekday `n` (1 = Monday) in the page's language, short. */
export function weekdayName(n: number, locale: string, style: 'short' | 'long' = 'short'): string {
  // 2024-01-01 was a Monday.
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, n)),
  );
}

/** `16:00–23:00` as the frames write it, `16:00 – 23:00`. */
export const spaced = (range: string): string => range.replace('–', ' – ');

/**
 * A date as the conventions write it, in every language: day, short month, year — "1 Sep 2026" in
 * English (day first, not "9/1/26"), "1 thg 9, 2026" in Vietnamese.
 */
export function formatDate(
  date: Date,
  locale: string,
  /** `UTC` for a calendar date (a legal version); the browser's own zone for a moment. */
  timeZone?: string,
): string {
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(timeZone === undefined ? {} : { timeZone }),
  };
  if (locale !== 'en') return new Intl.DateTimeFormat(locale, options).format(date);
  // English in day-month-year order with the three-letter month: en-GB now writes "Sept".
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((each) => each.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')}`;
}
