'use client';

import { cn } from '@wayfare/ui/cn';
import { niceTicks, tickIndexes } from './ticks';

/** The series' colours, in their fixed order (`chart-1` walking by, `chart-2` tapping, …). */
export const SERIES_COLOURS = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4'] as const;

/** One bar: its X label, its parts from the bottom (one for `single`). */
export interface BarPoint {
  readonly key: string;
  readonly label: string;
  readonly values: readonly number[];
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

/**
 * A daily or hourly series on one axis (handoff 40 §2): four nice Y ticks, a recessive grid, about
 * five X ticks, bars filling the width with a 4 px top radius and 2 px between stacked parts. One
 * image to a reader, named by `summary`; the numbers are the card's table view.
 */
export function BarChart({
  points,
  legend,
  summary,
  formatTick,
}: {
  points: readonly BarPoint[];
  /** The stacked parts' names, bottom first: drawn as the legend. */
  legend?: readonly string[];
  summary: string;
  formatTick: (value: number) => string;
}) {
  const ticks = niceTicks(Math.max(0, ...points.map((point) => sum(point.values))));
  const top = ticks[3];
  const shownTicks = new Set(tickIndexes(points.length));
  const middle = [...shownTicks][Math.floor(shownTicks.size / 2)];
  return (
    <div className="flex w-full flex-col gap-2">
      {legend === undefined ? null : (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {legend.map((name, index) => (
            <li key={name} className="flex items-center gap-1 text-xs text-muted-foreground">
              <span aria-hidden className={cn('size-2.5 rounded-xs', SERIES_COLOURS[index])} />
              {name}
            </li>
          ))}
        </ul>
      )}
      <div role="img" aria-label={summary} className="flex w-full flex-col gap-2">
        <div className="flex w-full items-start gap-2">
          <div
            aria-hidden
            className="flex h-45 w-6 shrink-0 flex-col items-end justify-between text-xs whitespace-nowrap text-muted-foreground"
          >
            {[...ticks].reverse().map((tick) => (
              <span key={tick} className="leading-none">
                {formatTick(tick)}
              </span>
            ))}
          </div>
          <div className="relative flex h-45 min-w-0 flex-1 items-end gap-1">
            {[0, 1, 2, 3].map((line) => (
              <div
                key={line}
                aria-hidden
                className="absolute inset-x-0 h-px bg-border"
                style={{ top: `${(line / 3) * 100}%` }}
              />
            ))}
            {points.map((point) => {
              const total = sum(point.values);
              return (
                <div
                  key={point.key}
                  aria-hidden
                  className="relative flex min-w-0 flex-1 animate-bar-grow flex-col-reverse gap-0.5 overflow-hidden rounded-t-sm"
                  style={{ height: `${top === 0 ? 0 : (total / top) * 100}%` }}
                >
                  {point.values.map((value, index) =>
                    value === 0 ? null : (
                      <div
                        key={index}
                        className={cn('w-full shrink-0', SERIES_COLOURS[index])}
                        style={{ flexGrow: value, flexBasis: 0 }}
                      />
                    ),
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div
          aria-hidden
          className="flex h-4 w-full pl-8 text-xs whitespace-nowrap text-muted-foreground"
        >
          {points.map((point, index) => (
            <span key={point.key} className="relative min-w-0 flex-1">
              {shownTicks.has(index) ? (
                <span
                  className={cn(
                    'absolute top-0',
                    // At phone width only the first, the middle and the last: the rest would touch.
                    index === 0 || index === points.length - 1 || index === middle
                      ? undefined
                      : 'hidden sm:inline',
                    index === 0
                      ? 'left-0'
                      : index === points.length - 1
                        ? 'right-0'
                        : 'left-1/2 -translate-x-1/2',
                  )}
                >
                  {point.label}
                </span>
              ) : null}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
