'use client';

import { adminAnalyticsHeatmap } from '@wayfare/api-client';
import { Label, Select } from '@wayfare/ui/field';
import { HeatMap } from '@wayfare/ui/heat-map';
import type { HeatCell } from '@wayfare/ui/heat-map';
import { EmptyState } from '@wayfare/ui/states';
import { Skeleton } from '@wayfare/ui/surfaces';
import { Clock, Hourglass } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useAreas, useNames } from '../content/reference';
import { useMapStyle } from '../content/place-page';
import { lowerFirst } from '../i18n/format';
import { useConsole } from '../i18n/provider';
import { AnalyticsHeader } from './admin-header';
import { formatDayHour } from './charts/format';
import { HeatLegend } from './charts/heat-legend';
import { Segmented } from './charts/segmented';
import { QUICK_DAYS, rangeDays } from './range';
import type { QuickDays } from './range';
import { bandWords, HOUR_BANDS } from './heat-bands';
import type { HourBand } from './heat-bands';
import { LoadFailed, useStatsRead } from './read';

/** An Area's box, `[west, south, east, north]`, from its boundary ring. */
function boxOf(ring: readonly (readonly number[])[]): [number, number, number, number] {
  const lngs = ring.map((point) => point[0]!);
  const lats = ring.map((point) => point[1]!);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

/**
 * *Analytics → Heatmap* (AD3): where phones were — ~150 m squares, never a glow — for an Area,
 * days and hours; what a square means; the busiest squares as the map's text equivalent.
 */
export function HeatmapView() {
  const { t, locale } = useConsole();
  const names = useNames();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const areas = useAreas();
  const areaId = params.get('area') ?? areas.data?.[0]?.id ?? null;
  const area = areas.data?.find((candidate) => candidate.id === areaId) ?? null;
  const quick: QuickDays = QUICK_DAYS.find((days) => String(days) === params.get('days')) ?? 30;
  const band: HourBand = HOUR_BANDS.find((value) => value === params.get('hours')) ?? '0-24';
  const days = useMemo(() => rangeDays({ kind: 'quick', days: quick }, new Date()), [quick]);
  const style = useMapStyle(areaId ?? '');
  const read = useStatsRead(
    ['admin-analytics-heatmap', areaId, days.from, days.to, band],
    async () =>
      (await adminAnalyticsHeatmap({ areaId: areaId!, from: days.from, to: days.to, hours: band }))
        .data,
    areaId !== null,
  );
  const data = read.data;
  const set = (key: string, value: string) => {
    const query = new URLSearchParams(params.toString());
    query.set(key, value);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  };
  const cells: HeatCell[] = useMemo(
    () =>
      (data?.cells.features ?? []).map((feature) => ({
        cell: feature.properties.cell,
        ring: feature.geometry.coordinates[0]!.map(([lng, lat]) => [lng, lat] as const),
        estimate: feature.properties.estimate,
      })),
    [data],
  );
  const bounds = useMemo(
    () => (area === null ? null : boxOf(area.boundary.coordinates[0] ?? [])),
    [area],
  );
  // "Map updated", politely, after a filter changed the squares — not on the first drawing.
  const [announced, setAnnounced] = useState('');
  const drawn = useRef<unknown>(undefined);
  useEffect(() => {
    if (data === undefined || read.stale) return;
    if (drawn.current !== undefined && drawn.current !== data)
      setAnnounced(t('analytics.heat.updated'));
    drawn.current = data;
  }, [data, read.stale, t]);
  const areaFieldId = useId();
  const busiest = (data?.cells.features ?? []).filter(
    (feature) => feature.properties.label !== undefined,
  );
  const where =
    band === '0-24' ? lowerFirst(t('analytics.heat.allDay'), locale) : bandWords(band).long;
  return (
    <>
      <AnalyticsHeader />
      {read.failed ? <LoadFailed onRetry={read.retry} /> : null}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex w-full flex-col gap-1 sm:w-auto sm:min-w-56">
            <Label htmlFor={areaFieldId}>{t('analytics.heat.area')}</Label>
            <Select
              id={areaFieldId}
              value={areaId ?? ''}
              onChange={(event) => set('area', event.target.value)}
            >
              {areaId === null ? (
                <option value="">{t('analytics.heat.areaPlaceholder')}</option>
              ) : null}
              {(areas.data ?? []).map((option) => (
                <option key={option.id} value={option.id}>
                  {names.area(option.code)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">{t('analytics.heat.days')}</span>
            <Segmented
              label={t('analytics.heat.days')}
              value={`${quick}`}
              onChange={(value) => set('days', value)}
              options={QUICK_DAYS.map((value) => ({
                value: `${value}` as const,
                label: t(`range.days${value}`),
              }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">{t('analytics.heat.hours')}</span>
            <Segmented
              label={t('analytics.heat.hours')}
              value={band}
              onChange={(value) => set('hours', value)}
              options={HOUR_BANDS.map((value) => ({
                value,
                label: value === '0-24' ? t('analytics.heat.allDay') : bandWords(value).short,
              }))}
            />
          </div>
        </div>
        {data?.computedThrough === null || data === undefined ? null : (
          <p
            className="flex items-center gap-1 self-start text-xs text-muted-foreground"
            data-fresh
          >
            <Clock aria-hidden className="size-4" />
            {t('range.freshHour', { date: formatDayHour(data.computedThrough, locale) })}
          </p>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {announced}
      </p>
      {read.failed && data === undefined ? null : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card px-6 py-5 lg:col-span-2">
            <h2 className="text-lg font-semibold text-card-foreground">
              {t('analytics.heat.where', { hours: where })}
            </h2>
            {style === null || area === null ? (
              <Skeleton className="h-96 w-full" />
            ) : (
              <HeatMap
                style={style}
                cells={cells}
                bounds={bounds}
                label={t('analytics.heat.map', { area: names.area(area.code) })}
              />
            )}
            <HeatLegend />
          </section>
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-2 rounded-lg border border-border bg-card px-6 py-5 text-sm text-card-foreground">
              <h2 className="text-lg font-semibold">{t('analytics.heat.whatTitle')}</h2>
              <p>{t('analytics.heat.what1')}</p>
              <p>{t('analytics.heat.what2')}</p>
              <p>{t('analytics.heat.what3')}</p>
            </section>
            <section className="flex flex-col gap-2 rounded-lg border border-border bg-card px-6 py-5">
              <h2 className="text-lg font-semibold text-card-foreground">
                {t('analytics.heat.busiest')}
              </h2>
              {data !== undefined && cells.length === 0 ? (
                <EmptyState
                  className="py-6"
                  icon={<Hourglass className="size-5" />}
                  title={t('analytics.empty.title')}
                  body={t('analytics.empty.body')}
                />
              ) : (
                <>
                  <ol className="flex flex-col">
                    {busiest.map((feature) => (
                      <li
                        key={feature.properties.cell}
                        className="flex items-start justify-between gap-3 py-2 text-sm"
                      >
                        <span className="text-foreground">
                          {feature.properties.label === null
                            ? t('analytics.heat.nowhere')
                            : t('analytics.heat.by', { place: feature.properties.label! })}
                        </span>
                        <span className="shrink-0 font-medium text-foreground">
                          {t('analytics.heat.phones', { n: feature.properties.estimate })}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <p className="text-xs text-muted-foreground">{t('analytics.heat.listLine')}</p>
                </>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
