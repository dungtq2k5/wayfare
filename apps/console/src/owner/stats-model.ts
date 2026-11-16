import type { ownerStatsPlace, ownerStatsPlaces } from '@wayfare/api-client';
import {
  formatCount,
  formatDay,
  formatListening,
  formatPercent,
  formatPercentNumber,
  formatShortDay,
} from '../analytics/charts/format';
import type { BarPoint } from '../analytics/charts/bar-chart';
import type { ChartTable } from '../analytics/charts/chart-card';
import type { Translator } from '../i18n/messages';

export type OwnerStats = Awaited<ReturnType<typeof ownerStatsPlaces>>['data'];
export type OwnerVenueStats = Awaited<ReturnType<typeof ownerStatsPlace>>['data'];
export type StatsFigures = OwnerStats['totals'];
export type StatsDay = OwnerStats['days'][number];
export type StatsVenue = OwnerVenueStats['venue'];

/** Below this many narrations, rates and averages give way to counts or "—" (handoff 40 §2). */
export const QUIET_FLOOR = 5;

/** Whether a range's numbers are too few for a rate (AO5). */
export const isQuiet = (figures: StatsFigures): boolean => figures.narrationsStarted < QUIET_FLOOR;

/** A tile: its label, value and note. */
export interface Tile {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly note: string;
}

/**
 * The tiles a level draws (handoff 40 §2): Growth's four, Pro's six — a field the answer doesn't
 * carry isn't drawn, never a 0. Under 5 narrations a rate is a count ("2 of 3") and an average
 * "—", each with its reason; QR scans keep their number, a 0 being a real zero.
 */
export function tilesFor(
  figures: StatsFigures,
  context: {
    /** "Across your {n} venues" on the owner's page; the Venue's own line on its page. */
    readonly narrationsNote: string;
  },
  { t, locale }: Translator,
): Tile[] {
  const quiet = isQuiet(figures);
  const started = figures.narrationsStarted;
  const ofStarted = (n: number) =>
    t('stats.nOfTotal', { n: formatCount(n, locale), total: formatCount(started, locale) });
  const tiles: Tile[] = [
    {
      key: 'narrations',
      label: t('stats.narrations'),
      value: formatCount(started, locale),
      note: context.narrationsNote,
    },
    quiet || figures.completionRate === null
      ? {
          key: 'finished',
          label: t('stats.finished'),
          value: ofStarted(figures.narrationsCompleted),
          note: t('stats.tooFew'),
        }
      : {
          key: 'finished',
          label: t('stats.finished'),
          value: formatPercent(figures.completionRate, locale, t),
          note: t('stats.playedToEnd', { n: formatCount(figures.narrationsCompleted, locale) }),
        },
  ];
  if (figures.narrationsAbandoned !== undefined) {
    const abandoned = figures.narrationsAbandoned;
    tiles.push(
      quiet
        ? {
            key: 'stopped',
            label: t('stats.stopped'),
            value: ofStarted(abandoned),
            note: t('stats.tooFew'),
          }
        : {
            key: 'stopped',
            label: t('stats.stopped'),
            value: formatCount(abandoned, locale),
            note: t('stats.ofNarrations', { n: formatPercentNumber(abandoned / started, locale) }),
          },
    );
  }
  if (figures.opens !== undefined)
    tiles.push({
      key: 'opens',
      label: t('stats.opens'),
      value: formatCount(figures.opens, locale),
      note: t('stats.inAppAndWeb'),
    });
  tiles.push(
    quiet || figures.averageListenMs === null
      ? { key: 'listening', label: t('stats.listening'), value: '—', note: t('stats.needsFive') }
      : {
          key: 'listening',
          label: t('stats.listening'),
          value: formatListening(figures.averageListenMs, t),
          note: t('stats.perNarration'),
        },
    {
      key: 'qr',
      label: t('stats.qrScans'),
      value: formatCount(figures.qrScans, locale),
      note: figures.qrScans === 0 ? t('stats.noScans') : t('stats.everyScan'),
    },
  );
  return tiles;
}

/** Whether a Venue went live inside the range: its *Narrations* tile then says since when. */
export function liveInside(venue: StatsVenue, from: string): string | null {
  if (venue.liveSince === null) return null;
  const day = venue.liveSince.slice(0, 10);
  return day >= from ? day : null;
}

/** A Venue's *Narrations* note: "Live since 2 Nov" when it went live inside the range, else "Since {from}". */
export function venueNarrationsNote(
  venue: StatsVenue,
  from: string,
  { t, locale }: Translator,
): string {
  const live = liveInside(venue, from);
  return live === null
    ? t('stats.since', { date: formatShortDay(from, locale) })
    : t('stats.liveSince', { date: formatShortDay(live, locale) });
}

/** The series' bars: one part (`BASIC`), or walking by, tapping, scanning from the bottom (`FULL`). */
export function statsPoints(days: readonly StatsDay[], locale: Translator['locale']): BarPoint[] {
  return days.map((day) => ({
    key: day.day,
    label: formatShortDay(day.day, locale),
    values:
      day.startedBy === undefined
        ? [day.narrationsStarted]
        : [day.startedBy.walkingBy, day.startedBy.tapping, day.startedBy.scanning],
  }));
}

/** The same days as the chart's table: a day a row, the parts and their total. */
export function statsTable(days: readonly StatsDay[], { t, locale }: Translator): ChartTable {
  return {
    firstColumn: t('chart.day'),
    rows: days.map((day) => ({
      key: day.day,
      label: formatDay(day.day, locale),
      values:
        day.startedBy === undefined
          ? [formatCount(day.narrationsStarted, locale)]
          : [
              day.startedBy.walkingBy,
              day.startedBy.tapping,
              day.startedBy.scanning,
              day.narrationsStarted,
            ].map((n) => formatCount(n, locale)),
    })),
  };
}

/** The chart's one-sentence reading: "Narrations per day, 24 Oct to 6 Nov, from 38 to 118". */
export function chartSummary(
  title: string,
  points: readonly BarPoint[],
  { t, locale }: Translator,
): string {
  const totals = points.map((point) => point.values.reduce((a, b) => a + b, 0));
  return t('chart.summary', {
    title,
    from: points[0]?.label ?? '',
    to: points.at(-1)?.label ?? '',
    min: formatCount(totals.length === 0 ? 0 : Math.min(...totals), locale),
    max: formatCount(totals.length === 0 ? 0 : Math.max(...totals), locale),
  });
}
