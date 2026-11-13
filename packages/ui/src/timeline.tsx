import { Circle, CircleCheck, CircleDot, CircleX } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';

/** Where a step stands: done, now, still to come, or the one that ended the story. */
export type TimelineState = 'done' | 'current' | 'upcoming' | 'stopped';

const ICON = {
  done: { icon: CircleCheck, className: 'text-primary' },
  current: { icon: CircleDot, className: 'text-info-foreground' },
  upcoming: { icon: Circle, className: 'text-muted-foreground' },
  stopped: { icon: CircleX, className: 'text-destructive' },
} as const;

/** *Timeline* (round 35): an ordered list of steps; the connector between them is decoration. */
export function Timeline({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ol aria-label={label} className="flex flex-col">
      {children}
    </ol>
  );
}

/**
 * One step: its state's icon (read as `stateLabel`, never only seen), the title, a meta line and
 * an optional note. The last step has no connector below it.
 */
export function TimelineItem({
  state,
  stateLabel,
  title,
  meta,
  note,
  last = false,
}: {
  state: TimelineState;
  stateLabel: string;
  title: ReactNode;
  meta?: ReactNode;
  note?: ReactNode;
  last?: boolean;
}) {
  const { icon: Icon, className } = ICON[state];
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <Icon aria-hidden className={cn('size-5 shrink-0', className)} />
        {last ? null : <span aria-hidden className="w-px flex-1 bg-border" />}
      </div>
      <div className={cn('flex min-w-0 flex-col gap-0.5', last ? 'pb-0' : 'pb-5')}>
        <span
          className={cn(
            'text-sm font-medium',
            state === 'upcoming' ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          <span className="sr-only">{stateLabel}: </span>
          {title}
        </span>
        {meta === undefined ? null : <span className="text-xs text-muted-foreground">{meta}</span>}
        {note === undefined ? null : <span className="text-sm text-muted-foreground">{note}</span>}
      </div>
    </li>
  );
}
