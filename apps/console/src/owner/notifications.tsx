'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  notificationsList,
  notificationsMarkAllRead,
  notificationsMarkRead,
} from '@wayfare/api-client';
import { Button } from '@wayfare/ui/button';
import { LoadMore, PageHeader } from '@wayfare/ui/list';
import { mergeCursorPages } from '@wayfare/ui/paging';
import { EmptyState } from '@wayfare/ui/states';
import { Card } from '@wayfare/ui/surfaces';
import { Bell, CheckCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { failureOf } from '../client/errors';
import { useConsole } from '../i18n/provider';
import { NotificationRow } from '../notifications/row';
import { notificationTarget, notificationText } from '../notifications/text';
import type { FeedNotification } from '../notifications/text';
import { UNREAD_KEY } from '../shell/notifications-socket';
import type { FeedPage } from '../shell/notifications-socket';
import { ErrorView } from '../states/states';
import { useOwnerPlaces } from './queries';

const PAGE = 20;

/**
 * Notifications (I1; K18): round 33's rows at page width, newest first, unread filled; *Mark all
 * read*; each opens the record it is about — a venue, a submission, the registration — whose page
 * carries the note and what to do. There is no page for one notification.
 */
export function NotificationsView() {
  const translator = useConsole();
  const { t } = translator;
  const router = useRouter();
  const queries = useQueryClient();
  const places = useOwnerPlaces();
  const feed = useInfiniteQuery({
    queryKey: ['notifications', 'page'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }): Promise<FeedPage> =>
      notificationsList({
        limit: PAGE,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }) as Promise<FeedPage>,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
  const rows = mergeCursorPages(feed.data?.pages.map((page) => page.data) ?? []);
  const names = new Map((places.data ?? []).map((place) => [place.id, place.nameVi]));
  const context = { placeName: (id: string) => names.get(id) };
  const unread = rows.some((row) => row.readAt === null);
  const now = new Date();

  const open = (row: FeedNotification) => {
    if (row.readAt === null)
      void notificationsMarkRead(row.id).then(() =>
        queries.invalidateQueries({ queryKey: UNREAD_KEY }),
      );
    router.push(notificationTarget(row));
  };

  return (
    <>
      <PageHeader
        title={t('notifications.title')}
        description={t('notifications.lead')}
        action={
          rows.length === 0 ? undefined : (
            <Button
              variant="outline"
              disabled={!unread}
              onClick={() =>
                void notificationsMarkAllRead().then(() =>
                  queries.invalidateQueries({ queryKey: ['notifications'] }),
                )
              }
            >
              <CheckCheck aria-hidden />
              {t('notifications.markAllRead')}
            </Button>
          )
        }
      />
      {feed.isError ? (
        <ErrorView failure={failureOf(feed.error)} onRetry={() => void feed.refetch()} />
      ) : feed.isSuccess && rows.length === 0 ? (
        <EmptyState
          icon={<Bell />}
          title={t('notifications.emptyTitle')}
          body={t('notifications.emptyBody')}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id}>
                <NotificationRow
                  row={row}
                  text={notificationText(row, context, translator)}
                  now={now}
                  onOpen={() => open(row)}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {feed.hasNextPage ? (
        <LoadMore
          label={t('notifications.loadMore')}
          busy={feed.isFetchingNextPage ? t('notifications.loadMore') : undefined}
          onLoad={() => void feed.fetchNextPage()}
        />
      ) : null}
    </>
  );
}
