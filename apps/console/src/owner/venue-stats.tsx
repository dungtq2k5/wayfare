'use client';

import { ownerStatsPlace } from '@wayfare/api-client';
import { cn } from '@wayfare/ui/cn';
import { PageHeader } from '@wayfare/ui/list';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { formatCount, formatPercentNumber, formatShortDay } from '../analytics/charts/format';
import { RankedRow } from '../analytics/charts/ranked-row';
import { StatTile, StatTiles } from '../analytics/charts/stat-tile';
import { RangePicker, useRange } from '../analytics/range-picker';
import { useNames } from '../content/reference';
import { useConsole } from '../i18n/provider';
import type { PlainKey } from '../i18n/messages';
import { NotFoundView } from '../states/states';
import { isQuiet, liveInside, tilesFor, venueNarrationsNote } from './stats-model';
import type { OwnerVenueStats } from './stats-model';
import { ExportButton, GrowthCard, Meanings, NoneCard, StatsChart } from './stats-parts';
import { LoadFailed, useStatsRead } from '../analytics/read';

/** *How stories started* (AO3b): walking by, tapping, scanning — each its count and share. */
function HowStarted({
  startedBy,
}: {
  startedBy: NonNullable<OwnerVenueStats['totals']['startedBy']>;
}) {
  const { t, locale } = useConsole();
  const rows: [PlainKey, PlainKey, number, string][] = [
    ['trigger.walking', 'stats.started.walking', startedBy.walkingBy, 'bg-chart-1'],
    ['trigger.tapping', 'stats.started.tapping', startedBy.tapping, 'bg-chart-2'],
    ['trigger.scanning', 'stats.started.scanning', startedBy.scanning, 'bg-chart-3'],
  ];
  const total = rows.reduce((sum, row) => sum + row[2], 0);
  const first = Math.max(...rows.map((row) => row[2]), 1);
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-card px-6 py-5">
      <h2 className="text-lg font-semibold text-card-foreground">{t('stats.howStarted')}</h2>
      <ol>
        {rows.map(([name, meaning, count, colour], index) => (
          <li key={name}>
            <RankedRow
              rank={index + 1}
              name={t(name)}
              meta={t(meaning)}
              value={`${formatCount(count, locale)} · ${t('chart.percent', {
                n: formatPercentNumber(total === 0 ? 0 : count / total, locale),
              })}`}
              share={count / first}
              colour={colour}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A Venue's stats (AO2, AO3b, AO5): its figures at the plan's depth over the page's range. */
export function VenueStatsView({ venueId }: { venueId: string }) {
  const translator = useConsole();
  const { t, locale } = translator;
  const names = useNames();
  const params = useSearchParams();
  const { range, days, choose } = useRange();
  const read = useStatsRead(
    ['owner-venue-stats', venueId, days.from, days.to],
    async () => (await ownerStatsPlace(venueId, { from: days.from, to: days.to })).data,
  );
  const query = params.toString();
  const breadcrumb = (
    <Link
      href={`/owner/stats${query === '' ? '' : `?${query}`}`}
      className="text-sm text-muted-foreground hover:underline"
    >
      {t('stats.title')}
    </Link>
  );
  if (read.notFound) return <NotFoundView />;
  if (read.noLevel)
    return (
      <>
        <PageHeader
          breadcrumb={breadcrumb}
          title={t('stats.title')}
          description={t('stats.leadShort')}
        />
        <NoneCard />
      </>
    );
  const data = read.data;
  const venue = data?.venue;
  const full = data?.analyticsLevel === 'FULL';
  const quiet = data !== undefined && isQuiet(data.totals);
  const tiles =
    data === undefined
      ? null
      : tilesFor(
          data.totals,
          { narrationsNote: venueNarrationsNote(data.venue, data.from, translator) },
          translator,
        );
  const live =
    venue === undefined
      ? null
      : (liveInside(venue, days.from) ?? venue.liveSince?.slice(0, 10) ?? null);
  return (
    <>
      <PageHeader
        breadcrumb={breadcrumb}
        title={venue?.name ?? '…'}
        {...(venue === undefined
          ? {}
          : {
              description: `${names.category(venue.categoryCode)} · ${names.area(venue.areaCode)}`,
            })}
        {...(full ? { action: <ExportButton from={days.from} to={days.to} /> } : {})}
      />
      {read.failed ? <LoadFailed onRetry={read.retry} /> : null}
      <RangePicker
        key={range.kind === 'custom' ? 'custom' : 'quick'}
        range={range}
        onChange={choose}
        dataThrough={data?.dataThrough}
        refused={read.refused}
      />
      {read.failed && data === undefined ? null : (
        <div
          className={cn(
            'flex flex-col gap-6 transition-opacity duration-normal',
            read.stale ? 'opacity-60' : 'opacity-100',
          )}
        >
          <StatTiles count={full ? 6 : 4}>
            {tiles === null
              ? Array.from({ length: 4 }, (_, index) => (
                  <StatTile key={index} label="" value={null} />
                ))
              : tiles.map((tile) => (
                  <StatTile key={tile.key} label={tile.label} value={tile.value} note={tile.note} />
                ))}
          </StatTiles>
          <StatsChart
            days={data?.days}
            quietLine={
              quiet && venue !== undefined
                ? live === null
                  ? t('stats.quietAll')
                  : t('stats.quietVenue', { venue: venue.name, date: formatShortDay(live, locale) })
                : null
            }
          />
          {quiet ? null : (
            <>
              {data?.totals.startedBy === undefined ? null : (
                <HowStarted startedBy={data.totals.startedBy} />
              )}
              {data === undefined ? null : <Meanings full={full} />}
              {data?.analyticsLevel === 'BASIC' ? <GrowthCard /> : null}
            </>
          )}
        </div>
      )}
    </>
  );
}
