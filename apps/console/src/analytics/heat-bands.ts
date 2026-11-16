/** The hours of day in Vietnam time a heatmap reads (`hours=`), *All day* first. */
export const HOUR_BANDS = ['0-24', '6-12', '12-18', '18-24', '0-6'] as const;
export type HourBand = (typeof HOUR_BANDS)[number];

/** A band as the filter writes it ("18–24") and as the map's title does ("18:00–24:00"). */
export function bandWords(band: HourBand): { short: string; long: string } {
  const [from, to] = band.split('-');
  return {
    short: `${from}–${to}`,
    long: `${from!.padStart(2, '0')}:00–${to!.padStart(2, '0')}:00`,
  };
}
