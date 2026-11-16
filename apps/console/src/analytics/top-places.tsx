'use client';

import { adminAnalyticsTopPlaces } from '@wayfare/api-client';
import { cn } from '@wayfare/ui/cn';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useNames } from '../content/reference';
import { useConsole } from '../i18n/provider';
import { AnalyticsHeader } from './admin-header';
import { formatCount, formatHours } from './charts/format';
import { RankedRow } from './charts/ranked-row';
import { Segmented } from './charts/segmented';
import { NothingCounted } from './overview';
import { RangePicker, useRange } from './range-picker';
import { LoadFailed, useStatsRead } from './read';

const METRICS = ['completed', 'started', 'listenMs'] as const;
type Metric = (typeof METRICS)[number];

/** How many Places the list ranks; named in the request so a server default never moves it. */
const TOP_LIMIT = 10;

/**
 * *Analytics → Top Places* (AD2): the ten Places most finished, started or listened to over the
 * range, each a link to its Place. Reading only — nothing here changes what plays.
 */
export function TopPlacesView() {
  const { t, tDynamic, locale } = useConsole();
  const names = useNames();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const metric: Metric = METRICS.find((value) => value === params.get('metric')) ?? 'completed';
  const { range, days, choose } = useRange();
  const read = useStatsRead(
    ['admin-analytics-top', metric, days.from, days.to],
    async () =>
      (await adminAnalyticsTopPlaces({ from: days.from, to: days.to, metric, limit: TOP_LIMIT }))
        .data,
  );
  const data = read.data;
  const value = (place: NonNullable<typeof data>['places'][number]) =>
    metric === 'listenMs'
      ? place.listenMs
      : metric === 'started'
        ? place.narrationsStarted
        : place.narrationsCompleted;
  const empty =
    data !== undefined &&
    (data.dataThrough === null || data.places.every((place) => value(place) === 0));
  const first = Math.max(1, ...(data?.places.map(value) ?? [1]));
  const setMetric = (next: Metric) => {
    const query = new URLSearchParams(params.toString());
    query.set('metric', next);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  };
  return (
    <>
      <AnalyticsHeader />
      {read.failed ? <LoadFailed onRetry={read.retry} /> : null}
      <RangePicker
        key={range.kind === 'custom' ? 'custom' : 'quick'}
        range={range}
        onChange={choose}
        dataThrough={data?.dataThrough}
        refused={read.refused}
        freshLabel={empty ? t('analytics.empty.title') : undefined}
        beside={
          <Segmented
            label={t('analytics.top.metric')}
            value={metric}
            onChange={setMetric}
            options={METRICS.map((option) => ({
              value: option,
              label: t(`analytics.top.${option}`),
            }))}
          />
        }
      />
      {read.failed && data === undefined ? null : empty ? (
        <NothingCounted chartTitle={t(`analytics.top.${metric}Title`)} />
      ) : (
        <section
          className={cn(
            'flex flex-col gap-2 rounded-lg border border-border bg-card px-6 py-5 transition-opacity duration-normal',
            read.stale ? 'opacity-60' : 'opacity-100',
          )}
        >
          <h2 className="text-lg font-semibold text-card-foreground">
            {t(`analytics.top.${metric}Title`)}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t(`analytics.top.${metric}Line`)} {t('analytics.top.ranking')}
          </p>
          <ol>
            {(data?.places ?? []).map((place, index) => (
              <li key={place.placeId}>
                <RankedRow
                  rank={index + 1}
                  name={
                    <Link
                      href={`/places/${place.placeId}`}
                      className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {place.name}
                    </Link>
                  }
                  meta={[
                    names.category(place.categoryCode),
                    ...(place.status === 'ACTIVE' ? [] : [tDynamic(`status.${place.status}`)]),
                  ].join(' · ')}
                  value={
                    metric === 'listenMs'
                      ? formatHours(place.listenMs, locale, t)
                      : formatCount(value(place), locale)
                  }
                  share={value(place) / first}
                />
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
