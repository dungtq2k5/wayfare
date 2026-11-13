'use client';

import { cn } from '@wayfare/ui/cn';
import { useConsole } from '../i18n/provider';
import { notificationIcon } from './icons';
import { relativeTime, splitNotification } from './text';
import type { FeedNotification } from './text';

/** The *Notification item*'s type icon, in a muted circle. */
function TypeIcon({ type }: { type: string }) {
  const Icon = notificationIcon(type);
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
    >
      <Icon className="size-4" />
    </span>
  );
}

/**
 * Round 33's *Notification item* (C10): its icon, its text and when; unread on the accent fill,
 * Medium weight, a dot, and read as "Unread". The bell's panel and the owner's page (I1) share it.
 */
export function NotificationRow({
  row,
  text,
  now,
  outlined = false,
  onOpen,
}: {
  row: FeedNotification;
  text: string;
  now: Date;
  outlined?: boolean;
  onOpen: () => void;
}) {
  const translator = useConsole();
  const { t } = translator;
  const [happened, then] = splitNotification(text);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full items-start gap-3 px-4 py-3 text-left text-sm text-foreground outline-none transition-shadow duration-(--duration-slow) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none motion-safe:animate-in motion-safe:slide-in-from-top-2',
        row.readAt === null && 'bg-accent',
        outlined && 'ring-2 ring-ring ring-inset',
      )}
    >
      <TypeIcon type={row.type} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {/* What happened, then what to do under it (round 33's row). */}
        <span className="font-medium">
          {row.readAt === null ? (
            <span className="sr-only">{t('notifications.unread')}: </span>
          ) : null}
          {happened}
        </span>
        {then === '' ? null : <span className="text-muted-foreground">{then}</span>}
        <span className="text-xs text-muted-foreground">
          {relativeTime(row.createdAt, now, translator)}
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          'mt-1 size-2 shrink-0 rounded-full',
          row.readAt === null ? 'bg-primary' : 'bg-transparent',
        )}
      />
    </button>
  );
}
