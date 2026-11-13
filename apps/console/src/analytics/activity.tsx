'use client';

import { adminAnalyticsRuntime } from '@wayfare/api-client';
import { Label, Select } from '@wayfare/ui/field';
import { EmptyState } from '@wayfare/ui/states';
import { Hourglass, Info } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId } from 'react';
import { useAreas, useNames } from '../content/reference';
import { useConsole } from '../i18n/provider';
import { AnalyticsHeader } from './admin-header';
import { ChartCard } from './charts/chart-card';
import { formatCount, formatHour } from './charts/format';
import { RankedRow } from './charts/ranked-row';
import { Segmented } from './charts/segmented';
import { LoadFailed, useStatsRead } from './read';

/** *Last 24 · Last 48 · Last 7 days*, in hours. */
const WINDOWS = ['24', '48', '168'] as const;
type Window = (typeof WINDOWS)[number];
const WINDOW_LABELS = {
  '24': 'analytics.act.h24',
  '48': 'analytics.act.h48',
  '168': 'analytics.act.d7',
} as const;

/**
 * *Analytics → Activity* (AD4): the consent-free lane, said first — installs per hour in an Area,
 * and every Area's this hour so far. Never added to the consented numbers.
 */
export function ActivityView() {
  const translator = useConsole();
  const { t, locale } = translator;
  const names = useNames();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const areas = useAreas();
  const areaId = params.get('area') ?? areas.data?.[0]?.id ?? null;
  const area = areas.data?.find((candidate) => candidate.id === areaId) ?? null;
  const window: Window = WINDOWS.find((value) => value === params.get('hours')) ?? '48';
  const hours = useStatsRead(
    ['admin-analytics-runtime', areaId, window],
    async () => (await adminAnalyticsRuntime({ areaId: areaId!, hours: Number(window) })).data,
    areaId !== null,
  );
  const now = useStatsRead(
    ['admin-analytics-runtime-now'],
    async () => (await adminAnalyticsRuntime({ current: 'true' })).data,
  );
  const set = (key: string, value: string) => {
    const query = new URLSearchParams(params.toString());
    query.set(key, value);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  };
  const areaFieldId = useId();
  const series = hours.data?.hours;
  const points = series?.map((hour) => ({
    key: hour.hourStart,
    label: formatHour(hour.hourStart, locale),
    values: [hour.estimate],
  }));
  const counted = series?.some((hour) => hour.estimate > 0) ?? true;
  const areaName = area === null ? '' : names.area(area.code);
  const title = t('analytics.act.perHour', { area: areaName });
  const current = now.data?.current?.areas ?? [];
  const first = Math.max(1, ...current.map((row) => row.estimate));
  const totals = points?.map((point) => point.values[0]!) ?? [];
  return (
    <>
      <AnalyticsHeader />
      {hours.failed || now.failed ? (
        <LoadFailed
          onRetry={() => {
            hours.retry();
            now.retry();
          }}
        />
      ) : null}
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
          <span className="text-sm font-medium text-foreground">{t('analytics.act.hours')}</span>
          <Segmented
            label={t('analytics.act.hours')}
            value={window}
            onChange={(value) => set('hours', value)}
            options={WINDOWS.map((value) => ({ value, label: t(WINDOW_LABELS[value]) }))}
          />
        </div>
      </div>
      <div
        role="note"
        className="flex items-start gap-2 rounded-lg bg-info px-4 py-3 text-sm text-info-foreground"
      >
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        <div className="flex flex-col gap-0.5">
          <p className="font-medium">{t('analytics.act.alertTitle')}</p>
          <p>{t('analytics.act.alertBody')}</p>
        </div>
      </div>
      {hours.failed && series === undefined ? null : (
        <ChartCard
          title={title}
          line={t('analytics.act.perHourLine')}
          points={points}
          summary={t('chart.summary', {
            title,
            from: points?.[0]?.label ?? '',
            to: points?.at(-1)?.label ?? '',
            min: formatCount(totals.length === 0 ? 0 : Math.min(...totals), locale),
            max: formatCount(totals.length === 0 ? 0 : Math.max(...totals), locale),
          })}
          formatTick={(value) => formatCount(value, locale)}
          table={{
            firstColumn: t('chart.hour'),
            rows: (series ?? []).map((hour) => ({
              key: hour.hourStart,
              label: formatHour(hour.hourStart, locale),
              values: [formatCount(hour.estimate, locale)],
            })),
          }}
          {...(counted
            ? {}
            : {
                empty: (
                  <EmptyState
                    className="py-8"
                    icon={<Hourglass className="size-5" />}
                    title={t('analytics.act.noHour')}
                    body={t('analytics.act.perHourLine')}
                  />
                ),
              })}
        />
      )}
      <section className="flex flex-col gap-2 rounded-lg border border-border bg-card px-6 py-5">
        <h2 className="text-lg font-semibold text-card-foreground">{t('analytics.act.now')}</h2>
        {now.data !== undefined && current.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('analytics.act.noHour')}</p>
        ) : (
          <ol data-now>
            {current.map((row, index) => (
              <li key={row.areaId}>
                <RankedRow
                  rank={index + 1}
                  name={names.area(row.code)}
                  meta={t('analytics.act.thisHour')}
                  value={t('analytics.act.approx', { n: formatCount(row.estimate, locale) })}
                  share={row.estimate / first}
                />
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
