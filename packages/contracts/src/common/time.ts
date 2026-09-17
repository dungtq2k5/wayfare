/** The single business time zone of the pilot (rdm-spec §2.2). */
export const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const DAY_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The calendar day an instant falls on in the business zone, as `YYYY-MM-DD` (rdm-spec §2.2).
 * Built from the parts, never from a locale's date pattern, which changes between ICU releases.
 */
export function businessDay(instant: Date): string {
  if (Number.isNaN(instant.getTime())) throw new RangeError('businessDay: invalid Date');
  const parts = Object.fromEntries(
    DAY_PARTS.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
