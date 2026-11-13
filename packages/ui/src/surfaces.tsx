import {
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  FileText,
  LoaderCircle,
  Check,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn('rounded-lg border border-border bg-card p-6 text-card-foreground', className)}
      {...props}
    />
  );
}

/** A card's title with the hairline under it (C11's sections, P3's). */
export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="border-b border-border pb-1 text-lg font-semibold text-foreground">
      {children}
    </h2>
  );
}

/** Stands in for text or a shape while a first load runs; still under reduced motion. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-sm bg-muted motion-reduce:animate-none', className)}
    />
  );
}

/** The statuses round 33 draws, each with its tone and icon. */
export type StatusTone =
  'draft' | 'processing' | 'active' | 'inactive' | 'pending' | 'approved' | 'rejected';

const TONES: Record<StatusTone, { className: string; icon: ReactNode }> = {
  draft: { className: 'bg-muted text-muted-foreground', icon: <FileText aria-hidden /> },
  processing: { className: 'bg-info text-info-foreground', icon: <LoaderCircle aria-hidden /> },
  active: { className: 'bg-success text-success-foreground', icon: <CircleCheck aria-hidden /> },
  inactive: { className: 'bg-offline text-offline-foreground', icon: <CircleDashed aria-hidden /> },
  pending: { className: 'bg-warning text-warning-foreground', icon: <Clock aria-hidden /> },
  approved: { className: 'bg-success text-success-foreground', icon: <Check aria-hidden /> },
  rejected: {
    className: 'border border-destructive bg-card text-destructive',
    icon: <CircleX aria-hidden />,
  },
};

/** Round 00's status badge: the word always, the colour and icon only reinforce it. */
export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3',
        TONES[tone].className,
      )}
    >
      {TONES[tone].icon}
      {children}
    </span>
  );
}

/** The account's initial at 32 px, never a photo. */
export function Avatar({ initial }: { initial: string }) {
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-medium text-accent-foreground"
    >
      {initial}
    </span>
  );
}
