import { openingState } from '@wayfare/core';
import type { OpeningHoursRowInput, OpeningState } from '@wayfare/core';
import { cn } from '@wayfare/ui/cn';
import { Clock } from 'lucide-react';
import type { Translator } from '../i18n/messages';
import { spaced, weekdayName } from './format';
import { hoursLines } from './hours-lines';

/** The badge's words (WQ1): open until, or closed and when it opens. */
export function openingLabel(
  state: OpeningState,
  t: Translator['t'],
  locale: string,
): string | null {
  if (state.kind === 'not-listed') return null;
  if (state.kind === 'open') return t('place.openUntil', { time: state.closesAt });
  if (state.opensAt === null) return t('place.closedNow');
  if (state.opensInDays === 0) return t('place.closedOpens', { time: state.opensAt });
  return t('place.closedOpensOn', {
    day: weekdayName(state.opensWeekday ?? 1, locale, 'long'),
    time: state.opensAt,
  });
}

/** The open-now badge beside the price band (WQ1). */
export function OpeningBadge({ label, open }: { label: string; open: boolean }) {
  return (
    <span
      className={cn(
        // A badge hugs its label, in a column too.
        'inline-flex min-h-6 items-center gap-1 self-start rounded-full px-2 py-0.5 text-sm font-medium',
        open ? 'bg-success text-success-foreground' : 'bg-secondary text-secondary-foreground',
      )}
    >
      <Clock aria-hidden className="size-4" />
      {label}
    </span>
  );
}

/** The opening hours (WQ1): the summary, the week with today marked, and special dates. */
export function OpeningHours({
  rows,
  now,
  t,
  locale,
}: {
  rows: readonly OpeningHoursRowInput[];
  now: number;
  t: Translator['t'];
  locale: string;
}) {
  const state = openingState(rows, now);
  const { week, specials } = hoursLines(rows, now);
  const summary =
    state.kind === 'open'
      ? t('place.openCloses', { time: state.closesAt })
      : openingLabel(state, t, locale);
  const ranges = (line: { ranges: readonly string[]; closed: boolean }) =>
    line.closed || line.ranges.length === 0
      ? t('place.closedAllDay')
      : line.ranges.map(spaced).join(', ');
  return (
    <div className="flex flex-col gap-2">
      {summary === null ? null : (
        <p
          className={cn(
            'flex min-h-11 items-center gap-2 text-base font-semibold',
            state.kind === 'open' ? 'text-success-foreground' : 'text-foreground',
          )}
        >
          <Clock aria-hidden className="size-5 shrink-0" />
          {summary}
        </p>
      )}
      <dl data-week className="flex flex-col">
        {week.map((line) => (
          <div
            key={line.weekday}
            className={cn(
              'flex items-center justify-between rounded-md px-3 py-1 text-sm font-medium',
              line.today && 'bg-accent text-accent-foreground',
            )}
          >
            <dt className={line.today ? 'text-base font-semibold' : 'text-foreground'}>
              {weekdayName(line.weekday, locale)}
            </dt>
            <dd className={line.today ? undefined : 'text-muted-foreground'}>{ranges(line)}</dd>
          </div>
        ))}
      </dl>
      {specials.length === 0 ? null : (
        <>
          <p className="pt-2 text-sm font-medium text-muted-foreground">
            {t('place.specialDates')}
          </p>
          <dl className="flex flex-col">
            {specials.map((line) => (
              <div
                key={line.date}
                className={cn(
                  'flex items-center justify-between rounded-md px-3 py-1 text-sm font-medium',
                  line.today && 'bg-accent text-accent-foreground',
                )}
              >
                <dt>
                  {new Intl.DateTimeFormat(locale, {
                    day: 'numeric',
                    month: 'short',
                    timeZone: 'UTC',
                  }).format(new Date(`${line.date}T00:00:00Z`))}
                </dt>
                <dd className={line.today ? undefined : 'text-muted-foreground'}>{ranges(line)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}
