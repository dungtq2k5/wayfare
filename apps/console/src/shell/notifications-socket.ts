'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { useState } from 'react';
import type { FeedNotification } from '../notifications/text';
import { useSocketEvent } from './socket';

export const UNREAD_KEY = ['notifications', 'unread'] as const;
export const FEED_KEY = ['notifications', 'feed'] as const;

export type FeedPage = { data: FeedNotification[]; meta: { nextCursor: string | null } };

/**
 * The notifications on the shell's socket (K10): the unread count is the server's, never a local
 * counter; a new notification is put first in the feed; a read marks its rows. Returns the newest
 * arrival, for the polite announcement and its outline.
 */
export function useNotificationSocket(): FeedNotification | null {
  const queries = useQueryClient();
  const [arrived, setArrived] = useState<FeedNotification | null>(null);

  const markRead = (read: (row: FeedNotification) => boolean) =>
    queries.setQueryData<InfiniteData<FeedPage>>(FEED_KEY, (feed) =>
      feed === undefined
        ? feed
        : {
            ...feed,
            pages: feed.pages.map((page) => ({
              ...page,
              data: page.data.map((row) =>
                row.readAt === null && read(row)
                  ? { ...row, readAt: new Date().toISOString() }
                  : row,
              ),
            })),
          },
    );
  useSocketEvent('notificationUnreadCount', ({ count }) => queries.setQueryData(UNREAD_KEY, count));
  useSocketEvent('notificationNew', (payload) => {
    const row: FeedNotification = { ...payload, readAt: null };
    queries.setQueryData<InfiniteData<FeedPage>>(FEED_KEY, (feed) =>
      feed === undefined ||
      feed.pages[0] === undefined ||
      feed.pages[0].data.some((item) => item.id === row.id)
        ? feed
        : {
            ...feed,
            pages: [
              { ...feed.pages[0], data: [row, ...feed.pages[0].data] },
              ...feed.pages.slice(1),
            ],
          },
    );
    setArrived(row);
  });
  useSocketEvent('notificationRead', (payload) => {
    if ('all' in payload) markRead(() => true);
    else markRead((row) => payload.ids.includes(row.id));
  });
  return arrived;
}
