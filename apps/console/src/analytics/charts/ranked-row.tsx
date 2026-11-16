import { cn } from '@wayfare/ui/cn';
import type { ReactNode } from 'react';

/**
 * A ranked item (handoff 40 §3): rank, name, meta, value, and a 160 px track whose bar is the
 * value's share of the first row's. The bar repeats the number, so readers skip it.
 */
export function RankedRow({
  rank,
  name,
  meta,
  value,
  share,
  colour = 'bg-chart-1',
}: {
  rank?: number | undefined;
  name: ReactNode;
  meta?: ReactNode;
  value: string;
  /** 0–1: this row's value ÷ the first row's. */
  share: number;
  colour?: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border py-2 last:border-b-0">
      {rank === undefined ? null : (
        <span className="w-5 shrink-0 text-sm font-medium text-muted-foreground">{rank}</span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm text-foreground">{name}</span>
        {meta === undefined ? null : <span className="text-xs text-muted-foreground">{meta}</span>}
      </div>
      <div
        aria-hidden
        className="hidden h-2 w-40 shrink-0 overflow-hidden rounded-sm bg-muted sm:block"
      >
        <div
          className={cn('h-2 rounded-sm', colour)}
          style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }}
        />
      </div>
      <span className="w-28 shrink-0 text-right text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}
