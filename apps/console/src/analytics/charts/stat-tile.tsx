'use client';

import { cn } from '@wayfare/ui/cn';
import { Skeleton } from '@wayfare/ui/surfaces';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { useConsole } from '../../i18n/provider';

/**
 * A headline number (handoff 40 §3): its label, value and note. `estimate` writes "≈" before the
 * value and adds the *Estimate* chip; a reader hears "about 6,900, estimate". `value` null is a
 * first load: the tile keeps its place with a skeleton.
 */
export function StatTile({
  label,
  value,
  note,
  kind = 'value',
}: {
  label: string;
  value: string | null;
  note?: string | undefined;
  kind?: 'value' | 'estimate';
}) {
  const { t } = useConsole();
  const estimate = kind === 'estimate';
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card p-4">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      {value === null ? (
        <Skeleton className="my-1 h-6 w-20" />
      ) : (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-2xl font-semibold whitespace-nowrap text-card-foreground">
            {estimate ? (
              <>
                <span aria-hidden>≈ {value}</span>
                <span className="sr-only">{t('chart.about', { value })}</span>
              </>
            ) : (
              value
            )}
          </p>
          {estimate ? (
            <span
              aria-hidden
              className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-sm font-medium whitespace-nowrap text-muted-foreground"
            >
              <Info className="size-3" />
              {t('chart.estimate')}
            </span>
          ) : null}
        </div>
      )}
      {note === undefined ? null : <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/**
 * The tiles: two a row on a phone, three from 640 px, and at full width four a row — or six as two
 * rows of three (Pro's AO3).
 */
export function StatTiles({ count, children }: { count: number; children: ReactNode }) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-4 sm:grid-cols-3',
        count === 4 ? 'xl:grid-cols-4' : undefined,
      )}
    >
      {children}
    </div>
  );
}
