import { CircleX } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * A link's target that is no longer on Wayfare (WQ4, TW3): round 33's *Empty state* centred in a
 * card — the icon, the title, why, and the one way on as its action.
 */
export function GoneCard({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-6 text-center">
      <span
        aria-hidden
        className="mb-2 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <CircleX className="size-6" />
      </span>
      <h1 className="text-xl font-semibold text-foreground">{title}</h1>
      <p className="max-w-sm text-base text-muted-foreground">{body}</p>
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  );
}
