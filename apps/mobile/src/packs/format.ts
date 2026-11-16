/**
 * A size as the handoff writes it: "48 MB", "0.4 MB", "1.2 GB" — one decimal under 10, none above.
 * Decimal megabytes, as Android's own storage screens count them.
 */
export function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const [value, unit] = bytes >= 1e9 ? [bytes / 1e9, 'GB'] : [bytes / 1e6, 'MB'];
  const tenths = Math.round(value * 10) / 10;
  const shown = tenths < 10 ? Math.max(tenths, 0.1).toFixed(1) : Math.round(value).toString();
  return `${shown} ${unit}`;
}

/** Whole minutes of listening, split for "1 h 6 min" / "48 min". */
export function listeningTime(durationMs: number): { hours: number; minutes: number } {
  const total = Math.round(durationMs / 60_000);
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** "14 Oct", in the app's language. */
export function shortDate(at: number | null, lang: string): string {
  // English as the design writes it, day first ("14 Oct"), not the American "Oct 14".
  const locale = lang === 'en' ? 'en-GB' : lang;
  return at === null
    ? ''
    : new Date(at).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}
