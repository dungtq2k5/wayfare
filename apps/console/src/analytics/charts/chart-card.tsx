'use client';

import { Skeleton } from '@wayfare/ui/surfaces';
import { ChartColumn, Table } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useConsole } from '../../i18n/provider';
import { BarChart } from './bar-chart';
import type { BarPoint } from './bar-chart';
import { Segmented } from './segmented';

/** A chart's numbers as the card's table: one row a bar, a column a part (and the total). */
export interface ChartTable {
  readonly firstColumn: string;
  readonly rows: readonly { key: string; label: string; values: readonly string[] }[];
}

/**
 * A chart in its card (handoff 40 §2): the title, *Chart · Table* (the same numbers as a real
 * table), the line, the chart. `points` undefined is a first load; `empty` replaces both views.
 */
export function ChartCard({
  title,
  line,
  points,
  legend,
  summary,
  formatTick,
  table,
  empty,
}: {
  title: string;
  line: string;
  points: readonly BarPoint[] | undefined;
  legend?: readonly string[];
  summary: string;
  formatTick: (value: number) => string;
  table: ChartTable;
  empty?: ReactNode;
}) {
  const { t } = useConsole();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const columns = [table.firstColumn, ...(legend ?? [title])];
  if (legend !== undefined) columns.push(t('chart.total'));
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card px-6 py-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 basis-48 text-lg font-semibold text-card-foreground">
          {title}
        </h2>
        {empty === undefined ? <ChartTableToggle view={view} onChange={setView} /> : null}
      </div>
      <p className="text-xs text-muted-foreground">{line}</p>
      {empty ??
        (points === undefined ? (
          <Skeleton className="h-52 w-full" />
        ) : view === 'chart' ? (
          <BarChart points={points} legend={legend} summary={summary} formatTick={formatTick} />
        ) : (
          <div
            // Scrolls on its own: a keyboard reaches it, and it says what it holds.
            tabIndex={0}
            role="region"
            aria-label={title}
            className="max-h-96 overflow-y-auto rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{title}</caption>
              <thead className="sticky top-0 bg-muted">
                <tr>
                  {columns.map((column, index) => (
                    <th
                      key={column}
                      scope="col"
                      className={
                        index === 0
                          ? 'px-2 py-2 font-normal text-muted-foreground'
                          : 'px-2 py-2 text-right font-normal text-muted-foreground'
                      }
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => (
                  <tr key={row.key} className="border-t border-border">
                    <th scope="row" className="px-2 py-1 font-normal text-foreground">
                      {row.label}
                    </th>
                    {row.values.map((value, index) => (
                      <td key={index} className="px-2 py-1 text-right text-card-foreground">
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}

function ChartTableToggle({
  view,
  onChange,
}: {
  view: 'chart' | 'table';
  onChange: (view: 'chart' | 'table') => void;
}) {
  const { t } = useConsole();
  return (
    <Segmented
      label={t('chart.view')}
      value={view}
      onChange={onChange}
      options={[
        { value: 'chart', label: t('chart.chart'), icon: ChartColumn },
        { value: 'table', label: t('chart.table'), icon: Table },
      ]}
    />
  );
}
