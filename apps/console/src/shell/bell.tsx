'use client';

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  notificationsList,
  notificationsMarkAllRead,
  notificationsMarkRead,
  notificationsUnreadCount,
  ownerPlacesList,
} from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { LoadMore } from '@wayfare/ui/list';
import { Popover, PopoverContent, PopoverTrigger } from '@wayfare/ui/menu';
import { mergeCursorPages } from '@wayfare/ui/paging';
import { EmptyState } from '@wayfare/ui/states';
import { cn } from '@wayfare/ui/cn';
import { Bell, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { failureOf } from '../client/errors';
import { useConsole } from '../i18n/provider';
import { notificationIcon } from '../notifications/icons';
import { notificationTarget, notificationText, relativeTime } from '../notifications/text';
import type { FeedNotification } from '../notifications/text';
import { ErrorView } from '../states/states';
import { useMe } from './me';
import { FEED_KEY, UNREAD_KEY, useNotificationSocket } from './notifications-socket';
import type { FeedPage } from './notifications-socket';

const PAGE = 20;
/** How long a new arrival stays outlined (handoff §7). */
const ARRIVAL_OUTLINE_MS = 2000;

/** The bell and its panel (C10): a live red count, the feed, *Mark all read*. */
export function NotificationBell() {
  const translator = useConsole();
  const { t } = translator;
  const me = useMe();
  const router = useRouter();
  const queries = useQueryClient();
  const [open, setOpen] = useState(false);
  const arrived = useNotificationSocket();
  const [outlined, setOutlined] = useState<string | null>(null);

  const unread = useQuery({
    queryKey: UNREAD_KEY,
    queryFn: async () => (await notificationsUnreadCount()).data.count,
  });
  const feed = useInfiniteQuery({
    queryKey: FEED_KEY,
    enabled: open,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }): Promise<FeedPage> =>
      notificationsList({
        limit: PAGE,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }) as Promise<FeedPage>,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
  // The owner's Place names, for the text; never stored in a notification (K10).
  const places = useQuery({
    queryKey: ['owner', 'places', 'names'],
    enabled: open && me.ownership === 'verified',
    queryFn: async () =>
      new Map((await ownerPlacesList()).data.map((place) => [place.id, place.nameVi])),
  });

  useEffect(() => {
    if (arrived === null) return;
    setOutlined(arrived.id);
    const timer = setTimeout(() => setOutlined(null), ARRIVAL_OUTLINE_MS);
    return () => clearTimeout(timer);
  }, [arrived]);

  const rows = useMemo(() => {
    const all = mergeCursorPages(feed.data?.pages.map((page) => page.data) ?? []);
    return [
      ...all.filter((row) => row.readAt === null),
      ...all.filter((row) => row.readAt !== null),
    ];
  }, [feed.data]);
  const context = { placeName: (id: string) => places.data?.get(id) };
  const count = unread.data ?? 0;
  const heading = useRef<HTMLHeadingElement>(null);
  const now = new Date();

  const openRow = (row: FeedNotification) => {
    setOpen(false);
    if (row.readAt === null)
      void notificationsMarkRead(row.id).then(() =>
        queries.invalidateQueries({ queryKey: UNREAD_KEY }),
      );
    router.push(notificationTarget(row));
  };

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {arrived === null ? '' : notificationText(arrived, context, translator)}
      </p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={count > 0 ? t('bar.notifications', { count }) : t('bar.notificationsNone')}
          >
            <Bell aria-hidden />
            {count > 0 ? (
              <span
                aria-hidden
                data-count
                className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-xs leading-none font-medium text-destructive-foreground"
              >
                {count > 9 ? '9+' : count}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="flex max-h-120 w-96 max-w-dvw flex-col"
          aria-label={t('notifications.title')}
          // Opening reads the panel from its title, then *Mark all read* (round 33's focus order).
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            heading.current?.focus();
          }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2
              ref={heading}
              tabIndex={-1}
              className="text-base font-semibold text-foreground outline-none"
            >
              {t('notifications.title')}
            </h2>
            {rows.length === 0 ? null : (
              <Button
                variant="ghost"
                size="sm"
                disabled={count === 0}
                onClick={() =>
                  void notificationsMarkAllRead().then(() =>
                    queries.invalidateQueries({ queryKey: ['notifications'] }),
                  )
                }
              >
                <CheckCheck aria-hidden />
                {t('notifications.markAllRead')}
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {feed.isError ? (
              <ErrorView failure={failureOf(feed.error)} onRetry={() => void feed.refetch()} />
            ) : feed.isSuccess && rows.length === 0 ? (
              <EmptyState
                icon={<Bell />}
                title={t('notifications.emptyTitle')}
                body={t('notifications.emptyBody')}
                className="py-8"
              />
            ) : (
              <ul className="flex flex-col">
                {rows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => openRow(row)}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left text-sm text-foreground outline-none transition-shadow duration-(--duration-slow) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none motion-safe:animate-in motion-safe:slide-in-from-top-2',
                        row.readAt === null && 'bg-accent',
                        outlined === row.id && 'ring-2 ring-ring ring-inset',
                      )}
                    >
                      <TypeIcon type={row.type} />
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className={row.readAt === null ? 'font-medium' : undefined}>
                          {row.readAt === null ? (
                            <span className="sr-only">{t('notifications.unread')}: </span>
                          ) : null}
                          {notificationText(row, context, translator)}
                        </span>
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
                  </li>
                ))}
              </ul>
            )}
            {feed.hasNextPage ? (
              <div className="p-3">
                <LoadMore
                  label={t('notifications.loadMore')}
                  busy={feed.isFetchingNextPage ? t('notifications.loadMore') : undefined}
                  onLoad={() => void feed.fetchNextPage()}
                />
              </div>
            ) : null}
          </div>
          {me.ownership === 'verified' ? (
            <div className="border-t border-border px-4 py-3 text-center">
              <Link
                href="/owner/notifications"
                onClick={() => setOpen(false)}
                className="rounded-sm text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('notifications.seeAll')}
              </Link>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </>
  );
}

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
