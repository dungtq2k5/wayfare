import { BUSINESS_TIME_ZONE } from '@wayfare/contracts';
import type { ConsoleT } from '../../i18n/messages';
import type { ConsoleLocale } from '../../i18n/messages';

const intl = (locale: ConsoleLocale) => (locale === 'vi' ? 'vi-VN' : 'en-GB');

/** A count, grouped: "3,412" ("3.412" in Vietnamese). */
export function formatCount(n: number, locale: ConsoleLocale): string {
  return new Intl.NumberFormat(intl(locale)).format(n);
}

/** A rate (0–1) as a whole percent's number: 0.68 → "68"; the key adds " %". */
export function formatPercentNumber(rate: number, locale: ConsoleLocale): string {
  return new Intl.NumberFormat(intl(locale), { maximumFractionDigits: 0 }).format(rate * 100);
}

/** A rate as the console writes it: "68 %". */
export function formatPercent(rate: number, locale: ConsoleLocale, t: ConsoleT): string {
  return t('chart.percent', { n: formatPercentNumber(rate, locale) });
}

/** Listening per narration: "1 min 48 s", "42 s". */
export function formatListening(ms: number, t: ConsoleT): string {
  const seconds = Math.round(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m === 0 ? t('chart.sec', { s }) : t('chart.minSec', { m, s });
}

/** A long listening total: "312 h 5 min". */
export function formatHours(ms: number, locale: ConsoleLocale, t: ConsoleT): string {
  const minutes = Math.round(ms / 60_000);
  return t('chart.hourMin', {
    h: formatCount(Math.floor(minutes / 60), locale),
    m: minutes % 60,
  });
}

/** A business day (`YYYY-MM-DD`) as a chart's short date: "24 Oct", "24 thg 10". */
export function formatShortDay(day: string, locale: ConsoleLocale): string {
  return new Intl.DateTimeFormat(intl(locale), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

/** A business day in full: "6 Nov 2026". */
export function formatDay(day: string, locale: ConsoleLocale): string {
  return new Intl.DateTimeFormat(intl(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

/** An hour's start in Vietnam time: "Thu 18:00". */
export function formatHour(iso: string, locale: ConsoleLocale): string {
  return new Intl.DateTimeFormat(intl(locale), {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: BUSINESS_TIME_ZONE,
  }).format(new Date(iso));
}

/** A day and hour in Vietnam time, for the heatmap's freshness: "7 Nov 2026, 10:00". */
export function formatDayHour(iso: string, locale: ConsoleLocale): string {
  return new Intl.DateTimeFormat(intl(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: BUSINESS_TIME_ZONE,
  }).format(new Date(iso));
}
