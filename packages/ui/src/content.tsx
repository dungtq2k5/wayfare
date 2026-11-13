import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Landmark,
  LoaderCircle,
  Minus,
  Pause,
  Pencil,
  Plus,
  Store,
  TriangleAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';
import type { DiffRun } from './word-diff';

const chip =
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0';

/** *Kind chip* (round 34): an Editorial Place or a Venue, on every row and header. */
export function KindChip({ kind, children }: { kind: 'EDITORIAL' | 'VENUE'; children: ReactNode }) {
  return (
    <span
      className={cn(
        chip,
        kind === 'EDITORIAL'
          ? 'bg-editorial text-editorial-foreground'
          : 'bg-muted text-muted-foreground',
      )}
    >
      {kind === 'EDITORIAL' ? <Landmark aria-hidden /> : <Store aria-hidden />}
      {children}
    </span>
  );
}

/** A submission's kind (S1, S2): `pencil` *Update*, `plus` *New venue* in the success tone. */
export function SubmissionKindChip({
  kind,
  children,
}: {
  kind: 'UPDATE' | 'CREATE';
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        chip,
        kind === 'CREATE' ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground',
      )}
    >
      {kind === 'CREATE' ? <Plus aria-hidden /> : <Pencil aria-hidden />}
      {children}
    </span>
  );
}

/** A job's or a task's state, in the job status badge's tones. */
export type JobTone =
  | 'queued'
  | 'running'
  | 'paused'
  | 'done'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'superseded'
  | 'waiting';

const JOB_TONES: Record<JobTone, { className: string; icon: ReactNode }> = {
  queued: { className: 'bg-muted text-muted-foreground', icon: <Clock aria-hidden /> },
  waiting: { className: 'bg-muted text-muted-foreground', icon: <Clock aria-hidden /> },
  running: {
    className: 'bg-info text-info-foreground',
    icon: <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />,
  },
  paused: { className: 'bg-warning text-warning-foreground', icon: <Pause aria-hidden /> },
  done: { className: 'bg-success text-success-foreground', icon: <CircleCheck aria-hidden /> },
  partial: { className: 'bg-warning text-warning-foreground', icon: <TriangleAlert aria-hidden /> },
  failed: {
    className: 'border border-destructive bg-card text-destructive',
    icon: <CircleX aria-hidden />,
  },
  cancelled: { className: 'bg-offline text-offline-foreground', icon: <Ban aria-hidden /> },
  superseded: {
    className: 'bg-offline text-offline-foreground',
    icon: <CircleDashed aria-hidden />,
  },
};

/** *Job status badge* (round 34): the word always; the colour and icon only reinforce it. */
export function JobStatusBadge({ tone, children }: { tone: JobTone; children: ReactNode }) {
  return (
    <span className={cn(chip, JOB_TONES[tone].className)}>
      {JOB_TONES[tone].icon}
      {children}
    </span>
  );
}

/** *Progress (web)*: the count is the information, the bar decoration. */
export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const share = max === 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <span aria-hidden className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-primary transition-all duration-(--duration-normal) ease-linear motion-reduce:transition-none"
          style={{ width: `${share}%` }}
        />
      </span>
      {label}
    </span>
  );
}

/** *Change chip* (round 34): what happened to a field, a photo, a dish. */
export function ChangeChip({
  change,
  children,
}: {
  change: 'added' | 'removed' | 'changed' | 'conflict';
  children: ReactNode;
}) {
  const tones = {
    added: { className: 'bg-success text-success-foreground', icon: <Plus aria-hidden /> },
    removed: { className: 'bg-muted text-muted-foreground', icon: <Minus aria-hidden /> },
    changed: { className: 'bg-info text-info-foreground', icon: <Pencil aria-hidden /> },
    conflict: {
      className: 'bg-warning text-warning-foreground',
      icon: <TriangleAlert aria-hidden />,
    },
  } as const;
  return (
    <span className={cn(chip, tones[change].className)}>
      {tones[change].icon}
      {children}
    </span>
  );
}

/**
 * One side of a word diff (S2): removed words struck through and red, added words underlined,
 * bold and green — `<del>` and `<ins>`, so colour is never the only signal.
 */
export function WordDiffText({
  runs,
  side,
}: {
  runs: readonly DiffRun[];
  side: 'before' | 'after';
}) {
  return (
    <p className="text-sm whitespace-pre-wrap text-foreground">
      {runs.map((run, index) => {
        if (run.kind === 'same') return <span key={index}>{run.text}</span>;
        if (side === 'before' && run.kind === 'removed') {
          return (
            <del key={index} className="text-destructive">
              {run.text}
            </del>
          );
        }
        if (side === 'after' && run.kind === 'added') {
          return (
            <ins key={index} className="font-semibold text-primary underline">
              {run.text}
            </ins>
          );
        }
        return null;
      })}
    </p>
  );
}
