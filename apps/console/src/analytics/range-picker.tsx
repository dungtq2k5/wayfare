'use client';

import { Button } from '@wayfare/ui/button';
import { FieldError, Label } from '@wayfare/ui/field';
import { Calendar, Clock } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { DayInput } from '../forms/day-input';
import { useConsole } from '../i18n/provider';
import { formatDay } from './charts/format';
import { Segmented } from './charts/segmented';
import { customProblem, parseRange, QUICK_DAYS, rangeDays, rangeQuery } from './range';
import type { QuickDays, Range } from './range';

/** The page's range, from its address; choosing one replaces the address, so a reload keeps it. */
export function useRange(now: () => Date = () => new Date()) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const range = useMemo(() => parseRange(new URLSearchParams(params.toString())), [params]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the clock is read once per range
  const days = useMemo(() => rangeDays(range, now()), [range]);
  const choose = (next: Range) =>
    router.replace(`${pathname}?${rangeQuery(new URLSearchParams(params.toString()), next)}`, {
      scroll: false,
    });
  return { range, days, choose };
}

/**
 * *7 · 30 · 90 days* and *Custom…* (handoff 40 §2): two days at most 93 apart, refused before any
 * request; then the freshness line. `refused` is the server's `400` for a range it won't read.
 */
export function RangePicker({
  range,
  onChange,
  dataThrough,
  refused = false,
  freshLabel,
  beside,
}: {
  range: Range;
  onChange: (range: Range) => void;
  /** The last day counted; undefined while loading. */
  dataThrough: string | null | undefined;
  refused?: boolean;
  /** In place of the freshness line: AD5's "Nothing counted yet". */
  freshLabel?: string | undefined;
  /** A choice that sits in the range's row, after *Custom…* (Top Places' metric). */
  beside?: ReactNode;
}) {
  const { t, locale } = useConsole();
  const [custom, setCustom] = useState(range.kind === 'custom');
  const [from, setFrom] = useState(range.kind === 'custom' ? range.from : '');
  const [to, setTo] = useState(range.kind === 'custom' ? range.to : '');
  const [problem, setProblem] = useState<'order' | 'tooLong' | null>(null);
  const errorId = useId();
  const fromId = useId();
  const toId = useId();
  const shownProblem = problem ?? (refused ? 'tooLong' : null);
  const apply = () => {
    const found = customProblem(from, to);
    setProblem(found);
    if (found === null) onChange({ kind: 'custom', from, to });
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<`${QuickDays}`>
          label={t('range.label')}
          value={range.kind === 'quick' && !custom ? `${range.days}` : null}
          onChange={(days) => {
            setCustom(false);
            setProblem(null);
            onChange({ kind: 'quick', days: Number(days) as QuickDays });
          }}
          options={QUICK_DAYS.map((days) => ({
            value: `${days}` as const,
            label: t(`range.days${days}`),
          }))}
        />
        {/* With two days chosen, *Custom…* is the chosen option and no quick range is. */}
        <Button
          variant="ghost"
          aria-expanded={custom}
          aria-pressed={custom}
          className={custom ? 'border border-input bg-background' : undefined}
          onClick={() => setCustom((open) => !open)}
        >
          <Calendar aria-hidden className="size-4" />
          {t('range.custom')}
        </Button>
        {beside}
        <span className="hidden flex-1 md:block" />
        {freshLabel === undefined && (dataThrough === undefined || dataThrough === null) ? null : (
          <p className="flex items-center gap-1 text-xs text-muted-foreground" data-fresh>
            <Clock aria-hidden className="size-4" />
            {freshLabel ?? t('range.fresh', { date: formatDay(dataThrough!, locale) })}
          </p>
        )}
      </div>
      {custom ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor={fromId}>{t('range.from')}</Label>
            <DayInput
              id={fromId}
              value={from}
              onChange={setFrom}
              aria-invalid={shownProblem !== null}
              aria-describedby={shownProblem === null ? undefined : errorId}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={toId}>{t('range.to')}</Label>
            <DayInput
              id={toId}
              value={to}
              onChange={setTo}
              aria-invalid={shownProblem !== null}
              aria-describedby={shownProblem === null ? undefined : errorId}
            />
          </div>
          <Button type="submit" variant="outline">
            {t('range.show')}
          </Button>
          {shownProblem === null ? null : (
            <div className="basis-full">
              <FieldError id={errorId}>
                {shownProblem === 'tooLong' ? t('range.tooLong') : t('range.order')}
              </FieldError>
            </div>
          )}
        </form>
      ) : null}
    </div>
  );
}
