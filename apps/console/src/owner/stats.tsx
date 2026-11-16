'use client';

import { ownerStatsPlaces } from '@wayfare/api-client';
import { cn } from '@wayfare/ui/cn';
import { DataList, ListCard, PageHeader, RowChevron } from '@wayfare/ui/list';
import type { Column, Sort } from '@wayfare/ui/list';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { formatCount, formatListening, formatPercent } from '../analytics/charts/format';
import { StatTile, StatTiles } from '../analytics/charts/stat-tile';
import { RangePicker, useRange } from '../analytics/range-picker';
import { useNames } from '../content/reference';
import { useConsole } from '../i18n/provider';
import { isQuiet, tilesFor } from './stats-model';
import type { OwnerStats } from './stats-model';
import { ExportButton, GrowthCard, NoneCard, StatsChart } from './stats-parts';
import { LoadFailed, useStatsRead } from '../analytics/read';

type VenueRow = OwnerStats['venues'][number];

/** The sortable number of a Venue row, by column. */
function sortValue(row: VenueRow, key: string): number {
  const totals = row.totals;
  switch (key) {
    case 'walking':
      return totals.startedBy?.walkingBy ?? 0;
    case 'tapping':
      return totals.startedBy?.tapping ?? 0;
    case 'scanning':
      return totals.startedBy?.scanning ?? 0;
    case 'finished':
      return totals.completionRate ?? -1;
    case 'listening':
      return totals.averageListenMs ?? -1;
    case 'qr':
      return totals.qrScans;
    default:
      return totals.narrationsStarted;
  }
}

/**
 * *My stats* (AO1, AO3, AO4, AO5): the owner's Venues at their plan's depth — Growth's four
 * figures, Pro's six with how stories started and the export, Free's explanation with no number.
 */
export function OwnerStatsView() {
  const translator = useConsole();
  const { t, locale } = translator;
  const names = useNames();
  const params = useSearchParams();
  const { range, days, choose } = useRange();
  const read = useStatsRead(
    ['owner-stats', days.from, days.to],
    async () => (await ownerStatsPlaces({ from: days.from, to: days.to })).data,
  );
  const [sort, setSort] = useState<Sort>({ key: 'narrations', direction: 'descending' });
  if (read.noLevel)
    return (
      <>
        <PageHeader title={t('stats.title')} description={t('stats.leadShort')} />
        <NoneCard />
      </>
    );
  const data = read.data;
  const full = data?.analyticsLevel === 'FULL';
  const tiles =
    data === undefined
      ? null
      : tilesFor(
          data.totals,
          { narrationsNote: t('stats.acrossVenues', { n: data.venues.length }) },
          translator,
        );
  const columns: Column[] = [
    { key: 'venue', label: t('stats.venue') },
    {
      key: 'narrations',
      label: t('stats.narrations'),
      sortable: true,
      className: 'whitespace-nowrap',
    },
    ...(full
      ? [
          {
            key: 'walking',
            label: t('trigger.walking'),
            sortable: true,
            className: 'whitespace-nowrap',
          },
          {
            key: 'tapping',
            label: t('trigger.tapping'),
            sortable: true,
            className: 'whitespace-nowrap',
          },
          {
            key: 'scanning',
            label: t('trigger.scanning'),
            sortable: true,
            className: 'whitespace-nowrap',
          },
        ]
      : []),
    { key: 'finished', label: t('stats.finished'), sortable: true, className: 'whitespace-nowrap' },
    {
      key: 'listening',
      label: full ? t('stats.listeningShort') : t('stats.listening'),
      sortable: true,
      className: 'whitespace-nowrap',
    },
    { key: 'qr', label: t('stats.qrScans'), sortable: true, className: 'whitespace-nowrap' },
  ];
  const rows =
    data === undefined
      ? undefined
      : data.venues.toSorted((a, b) => {
          const order = sortValue(a, sort.key) - sortValue(b, sort.key);
          return sort.direction === 'ascending' ? order : -order;
        });
  const query = params.toString();
  const venueHref = (row: VenueRow) =>
    `/owner/stats/${row.placeId}${query === '' ? '' : `?${query}`}`;
  /** The card's facts: every column of the table, each value before its word, kept whole. */
  const cardFacts = (row: VenueRow) => {
    const totals = row.totals;
    const count = (n: number) => formatCount(n, locale);
    return (
      [
        t('stats.card.narrations', { n: count(totals.narrationsStarted) }),
        ...(totals.startedBy === undefined
          ? []
          : [
              t('stats.card.walking', { n: count(totals.startedBy.walkingBy) }),
              t('stats.card.tapping', { n: count(totals.startedBy.tapping) }),
              t('stats.card.scanning', { n: count(totals.startedBy.scanning) }),
            ]),
        ...(totals.completionRate === null
          ? []
          : [t('stats.card.finished', { n: formatPercent(totals.completionRate, locale, t) })]),
        ...(totals.averageListenMs === null ? [] : [formatListening(totals.averageListenMs, t)]),
        t('stats.card.qr', { n: count(totals.qrScans) }),
      ]
        // Each value holds together; the line breaks only between them.
        .map((value) => value.replaceAll(' ', '\u00a0'))
        .join(' · ')
    );
  };
  const line = (row: VenueRow) =>
    `${names.category(row.categoryCode)} · ${names.area(row.areaCode)}`;
  const cell = (row: VenueRow, key: string) => {
    const totals = row.totals;
    switch (key) {
      case 'venue':
        return (
          <Link
            href={venueHref(row)}
            className="flex flex-col rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="font-medium text-foreground">{row.name}</span>
            <span className="text-xs text-muted-foreground">{line(row)}</span>
          </Link>
        );
      case 'finished':
        return totals.completionRate === null
          ? '—'
          : formatPercent(totals.completionRate, locale, t);
      case 'listening':
        return totals.averageListenMs === null ? '—' : formatListening(totals.averageListenMs, t);
      default:
        return formatCount(sortValue(row, key), locale);
    }
  };
  return (
    <>
      <PageHeader
        title={t('stats.title')}
        description={t('stats.lead')}
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
            quietLine={data !== undefined && isQuiet(data.totals) ? t('stats.quietAll') : null}
          />
          <DataList
            caption={t('stats.venues')}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.placeId}
            cell={cell}
            sort={sort}
            onSort={setSort}
            skeletonRows={3}
            rowEnd={{ label: t('stats.openVenue'), render: () => <RowChevron /> }}
            card={(row) => (
              <ListCard
                name={
                  <Link
                    href={venueHref(row)}
                    className="font-medium text-foreground hover:underline"
                  >
                    {row.name}
                  </Link>
                }
                facts={line(row)}
                wrapFacts
                time={cardFacts(row)}
              />
            )}
          />
          {data?.analyticsLevel === 'BASIC' ? <GrowthCard /> : null}
        </div>
      )}
    </>
  );
}
