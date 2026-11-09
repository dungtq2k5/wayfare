'use client';

import { ApiError, ownerStatsExport } from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { EmptyState } from '@wayfare/ui/states';
import { toast } from '@wayfare/ui/toaster';
import { ChartColumn, Clock, FileDown, Hourglass, QrCode } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ChartCard } from '../analytics/charts/chart-card';
import { formatCount } from '../analytics/charts/format';
import { useConsole } from '../i18n/provider';
import type { PlainKey } from '../i18n/messages';
import { chartSummary, statsPoints, statsTable } from './stats-model';
import type { StatsDay } from './stats-model';

/** *Narrations per day* — by how they started at Pro — or, with little data, why it's quiet. */
export function StatsChart({
  days,
  quietLine,
}: {
  days: readonly StatsDay[] | undefined;
  /** Set when there's too little to draw (AO5): the empty state's line. */
  quietLine: string | null;
}) {
  const translator = useConsole();
  const { t } = translator;
  const stacked = days?.[0]?.startedBy !== undefined;
  const title = stacked ? t('stats.byTrigger') : t('stats.perDay');
  const points = days === undefined ? undefined : statsPoints(days, translator.locale);
  return (
    <ChartCard
      title={title}
      line={stacked ? t('stats.byTriggerLine') : t('stats.perDayLine')}
      points={points}
      {...(stacked
        ? { legend: [t('trigger.walking'), t('trigger.tapping'), t('trigger.scanning')] }
        : {})}
      summary={points === undefined ? title : chartSummary(title, points, translator)}
      formatTick={(value) => formatCount(value, translator.locale)}
      table={statsTable(days ?? [], translator)}
      {...(quietLine === null
        ? {}
        : {
            empty: (
              <EmptyState
                className="py-8"
                icon={<Hourglass className="size-5" />}
                title={t('stats.quietTitle')}
                body={quietLine}
              />
            ),
          })}
    />
  );
}

/** *Export CSV* (Pro): the range's rows as a file the console names by the gateway's rule. */
export function ExportButton({ from, to }: { from: string; to: string }) {
  const { t, locale } = useConsole();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      // The client answers a non-JSON body as a Blob, and the cross-origin gateway exposes no
      // Content-Disposition: the name is built here, as the gateway builds it.
      const body = (await ownerStatsExport({ from, to, lang: locale })) as unknown as Blob;
      const url = URL.createObjectURL(body);
      const link = document.createElement('a');
      link.href = url;
      link.download = `wayfare-stats-${from}-${to}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.code === 'ANALYTICS_LEVEL_INSUFFICIENT'
          ? t('stats.exportRefused')
          : t('stats.exportFailed'),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      variant="outline"
      busy={busy ? t('stats.exportCsv') : undefined}
      onClick={() => void save()}
    >
      <FileDown aria-hidden className="size-4" />
      {t('stats.exportCsv')}
    </Button>
  );
}

/** What Growth shows, and Pro besides (AO1, AO2). */
export function GrowthCard() {
  const { t } = useConsole();
  return (
    <section className="flex flex-col items-start gap-2 rounded-lg border border-border bg-card px-6 py-5">
      <h2 className="text-lg font-semibold text-card-foreground">{t('stats.growthTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('stats.growthBody')}</p>
      <Button variant="outline" asChild>
        <Link href="/owner/plans">{t('stats.seePlans')}</Link>
      </Button>
    </section>
  );
}

/** Free (AO4): what Growth and Pro would show — not a number on the page, not even a zero. */
export function NoneCard() {
  const { t } = useConsole();
  const bullets: [typeof ChartColumn, PlainKey][] = [
    [ChartColumn, 'stats.noneStarted'],
    [Clock, 'stats.noneListened'],
    [QrCode, 'stats.noneScanned'],
  ];
  return (
    <section className="flex flex-col items-start gap-3 rounded-lg border border-border bg-card px-6 py-5">
      <h2 className="text-lg font-semibold text-card-foreground">{t('stats.noneTitle')}</h2>
      <p className="text-sm text-foreground">{t('stats.noneLead')}</p>
      <ul className="flex flex-col gap-1 text-sm text-foreground">
        {bullets.map(([Icon, key]) => (
          <li key={key} className="flex items-center gap-2">
            <Icon aria-hidden className="size-4 text-muted-foreground" />
            {t(key)}
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">{t('stats.nonePro')}</p>
      <Button asChild>
        <Link href="/owner/plans">{t('stats.seePlans')}</Link>
      </Button>
    </section>
  );
}

/** *What each number means*: the lines of the level shown only. */
export function Meanings({ full }: { full: boolean }) {
  const { t } = useConsole();
  const rows: [PlainKey, PlainKey][] = [
    ['stats.narrations', 'stats.meaning.narrations'],
    ['stats.finished', 'stats.meaning.finished'],
    ...(full
      ? ([
          ['stats.stopped', 'stats.meaning.stopped'],
          ['stats.opens', 'stats.meaning.opens'],
        ] as [PlainKey, PlainKey][])
      : []),
    ['stats.listening', 'stats.meaning.listening'],
    ['stats.qrScans', 'stats.meaning.qr'],
  ];
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-card px-6 py-5">
      <h2 className="text-lg font-semibold text-card-foreground">{t('stats.meanings')}</h2>
      <dl className="flex flex-col gap-1 text-sm">
        {rows.map(([term, meaning]) => (
          <div key={term} className="flex flex-col sm:flex-row sm:gap-6">
            <dt className="shrink-0 text-muted-foreground sm:w-40">{t(term)}</dt>
            <dd className="text-foreground">{t(meaning)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">{t('stats.meaning.footer')}</p>
    </section>
  );
}
