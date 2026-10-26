import type { ConsoleLocale } from './messages';

/** The console's date: day, short month, year — "2 Oct 2026", "2 thg 10, 2026". */
export function formatDate(iso: string, locale: ConsoleLocale): string {
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

/** The console's time of day: 24-hour, with no AM or PM — "14:05". */
export function formatTime(iso: string, locale: ConsoleLocale): string {
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/**
 * A phone number as Vietnam writes it: the national form, in groups — a landline (02x) as
 * "028 3940 1234", a mobile as "090 812 3456". A number from elsewhere stays as it is stored.
 */
export function formatPhone(e164: string): string {
  if (!e164.startsWith('+84')) return e164;
  const national = `0${e164.slice(3)}`;
  const groups = national.startsWith('02') ? [3, 4, 4] : [3, 3, 4];
  const parts: string[] = [];
  let at = 0;
  for (const size of groups) {
    if (at >= national.length) break;
    parts.push(national.slice(at, at + size));
    at += size;
  }
  if (at < national.length) parts.push(national.slice(at));
  return parts.join(' ');
}

/** A narration's length: "2:14". */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A relative time inside a sentence: "Updated yesterday", not "Updated Yesterday". */
export function lowerFirst(text: string, locale: ConsoleLocale): string {
  return text.charAt(0).toLocaleLowerCase(locale) + text.slice(1);
}
