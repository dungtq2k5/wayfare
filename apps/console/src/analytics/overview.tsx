'use client';

import { adminAnalyticsOverview } from '@wayfare/api-client';
import { cn } from '@wayfare/ui/cn';
import { EmptyState } from '@wayfare/ui/states';
import { Hourglass } from 'lucide-react';
import { useConsole } from '../i18n/provider';
import { autonym, languageName } from '../i18n/language-names';
import type { PlainKey } from '../i18n/messages';
import { chartSummary, statsPoints, statsTable } from '../owner/stats-model';
import { AnalyticsHeader } from './admin-header';
import { ChartCard } from './charts/chart-card';
import { formatCount, formatPercent, formatPercentNumber } from './charts/format';
import { RankedRow } from './charts/ranked-row';
import { StatTile, StatTiles } from './charts/stat-tile';
import { languageRows, nothingCounted, tierRows } from './overview-model';
import type { Overview, RankedShare } from './overview-model';
import { RangePicker, useRange } from './range-picker';
import { LoadFailed, useStatsRead } from './read';

const TIER_COLOURS: Record<string, string> = {
  t1: 'bg-chart-1',
  t1_5: 'bg-chart-2',
  t2: 'bg-chart-3',
  t3: 'bg-chart-4',
};

/** A ranked card: its title, its line, its rows. */
function RankedCard({
  title,
  line,
  children,
}: {
  title: string;
  line: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card px-6 py-5">
      <h2 className="text-lg font-semibold text-card-foreground">{title}</h2>
      <p className="text-xs text-muted-foreground">{line}</p>
      <ol>{children}</ol>
    </section>
  );
}

/** "16,906 · 41 %": a count and its share. */
function countAndShare(
  row: RankedShare,
  locale: 'en' | 'vi',
  t: ReturnType<typeof useConsole>['t'],
) {
  return `${formatCount(row.count, locale)} · ${t('chart.percent', { n: formatPercentNumber(row.share, locale) })}`;
}

function OverviewBody({ data }: { data: Overview }) {
  const translator = useConsole();
  const { t, locale } = translator;
  const totals = data.totals;
  const days = data.days.map((day) => ({
    day: day.day,
    narrationsStarted: day.narrationsStarted,
    startedBy: day.byTrigger,
  }));
  const points = statsPoints(days, locale);
  const title = t('stats.byTrigger');
  const languages = languageRows(data.languages);
  return (
    <>
      <StatTiles count={6}>
        <StatTile
          label={t('analytics.sessions')}
          value={formatCount(totals.sessions, locale)}
          note={t('analytics.sessionsNote')}
        />
        <StatTile
          kind="estimate"
          label={t('analytics.activePhones')}
          value={formatCount(totals.activeDevicesEstimate, locale)}
          note={t('analytics.activePhonesNote')}
        />
        <StatTile
          label={t('stats.narrations')}
          value={formatCount(totals.narrationsStarted, locale)}
          note={t('analytics.narrationsNote')}
        />
        <StatTile
          label={t('stats.finished')}
          value={
            totals.completionRate === null ? '—' : formatPercent(totals.completionRate, locale, t)
          }
          note={t('stats.playedToEnd', { n: formatCount(totals.narrationsCompleted, locale) })}
        />
        <StatTile
          label={t('stats.qrScans')}
          value={formatCount(totals.qrScans, locale)}
          note={t('stats.everyScan')}
        />
        <StatTile
          label={t('analytics.downloads')}
          value={formatCount(totals.packInstalls, locale)}
          note={t('analytics.downloadsNote')}
        />
      </StatTiles>
      <ChartCard
        title={title}
        line={t('stats.byTriggerLine')}
        points={points}
        legend={[t('trigger.walking'), t('trigger.tapping'), t('trigger.scanning')]}
        summary={chartSummary(title, points, translator)}
        formatTick={(value) => formatCount(value, locale)}
        table={statsTable(days, translator)}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RankedCard title={t('analytics.audio')} line={t('analytics.audioLine')}>
          {tierRows(totals.byTier).map((row, index) => (
            <li key={row.key}>
              <RankedRow
                rank={index + 1}
                name={t(`analytics.tier.${row.key}` as PlainKey)}
                meta={t(`analytics.tier.${row.key}Line` as PlainKey)}
                value={countAndShare(row, locale, t)}
                share={row.ofFirst}
                colour={TIER_COLOURS[row.key]}
              />
            </li>
          ))}
        </RankedCard>
        <RankedCard title={t('analytics.languages')} line={t('analytics.languagesLine')}>
          {languages.rows.map((row, index) => {
            const others = row.key === 'others';
            const own = others ? t('analytics.others') : autonym(row.key);
            const english = others ? undefined : languageName(row.key, 'en');
            return (
              <li key={row.key}>
                <RankedRow
                  rank={index + 1}
                  name={<span lang={others ? undefined : row.key}>{own}</span>}
                  meta={
                    others
                      ? t('analytics.othersMeta', { n: languages.othersCount })
                      : english === own
                        ? undefined
                        : english
                  }
                  value={countAndShare(row, locale, t)}
                  share={row.ofFirst}
                />
              </li>
            );
          })}
        </RankedCard>
      </div>
    </>
  );
}

/** Nothing counted for the range (AD5): every total empty — not zero — and why. */
export function NothingCounted({ chartTitle }: { chartTitle: string }) {
  const { t } = useConsole();
  const tiles: PlainKey[] = [
    'analytics.sessions',
    'analytics.activePhones',
    'stats.narrations',
    'stats.finished',
  ];
  return (
    <>
      <StatTiles count={4}>
        {tiles.map((label) => (
          <StatTile key={label} label={t(label)} value="—" note={t('analytics.empty.noDay')} />
        ))}
      </StatTiles>
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card px-6 py-5">
        <h2 className="text-lg font-semibold text-card-foreground">{chartTitle}</h2>
        <EmptyState
          className="py-8"
          icon={<Hourglass className="size-5" />}
          title={t('analytics.empty.title')}
          body={t('analytics.empty.body')}
        />
      </section>
    </>
  );
}

/** *Analytics → Overview* (AD1, AD5): the range's totals, its days by trigger, the ladder, the languages. */
export function OverviewView() {
  const { t } = useConsole();
  const { range, days, choose } = useRange();
  const read = useStatsRead(
    ['admin-analytics-overview', days.from, days.to],
    async () => (await adminAnalyticsOverview({ from: days.from, to: days.to })).data,
  );
  const data = read.data;
  const empty = data !== undefined && nothingCounted(data);
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
      />
      {read.failed && data === undefined ? null : (
        <div
          className={cn(
            'flex flex-col gap-6 transition-opacity duration-normal',
            read.stale ? 'opacity-60' : 'opacity-100',
          )}
        >
          {data === undefined ? (
            <StatTiles count={6}>
              {Array.from({ length: 6 }, (_, index) => (
                <StatTile key={index} label="" value={null} />
              ))}
            </StatTiles>
          ) : empty ? (
            <NothingCounted chartTitle={t('stats.perDay')} />
          ) : (
            <OverviewBody data={data} />
          )}
        </div>
      )}
    </>
  );
}
