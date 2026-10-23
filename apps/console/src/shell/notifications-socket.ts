'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { SOCKET_EVENTS } from '@wayfare/contracts';
import type { SocketPayload } from '@wayfare/contracts';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { session } from '../client/browser-api';
import { API_ORIGIN } from '../env';
import type { FeedNotification } from '../notifications/text';

export const UNREAD_KEY = ['notifications', 'unread'] as const;
export const FEED_KEY = ['notifications', 'feed'] as const;

export type FeedPage = { data: FeedNotification[]; meta: { nextCursor: string | null } };

/**
 * The notification socket (K10): `/ws`, WebSocket only, the access cookie, `auth.client:
 * "console"`. The unread count is the server's, never a local counter; a new notification is put
 * first in the feed; a read marks its rows. A refusal for the session refreshes once, by K4's rule,
 * and connects again. Returns the newest arrival, for the polite announcement and its outline.
 */
export function useNotificationSocket(): FeedNotification | null {
  const queries = useQueryClient();
  const [arrived, setArrived] = useState<FeedNotification | null>(null);

  useEffect(() => {
    const socket = io(`${API_ORIGIN}/ws`, {
      transports: ['websocket'],
      withCredentials: true,
      auth: { client: 'console' },
    });
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
    socket.on(
      SOCKET_EVENTS.notificationUnreadCount,
      ({ count }: SocketPayload<'notificationUnreadCount'>) => {
        queries.setQueryData(UNREAD_KEY, count);
      },
    );
    socket.on(SOCKET_EVENTS.notificationNew, (payload: SocketPayload<'notificationNew'>) => {
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
    socket.on(SOCKET_EVENTS.notificationRead, (payload: SocketPayload<'notificationRead'>) => {
      if ('all' in payload) markRead(() => true);
      else markRead((row) => payload.ids.includes(row.id));
    });
    socket.on(SOCKET_EVENTS.error, ({ code }: { code: string }) => {
      if (code !== 'UNAUTHENTICATED') return;
      void session.refresh().then((fresh) => {
        if (fresh) socket.connect();
      });
    });
    return () => {
      socket.disconnect();
    };
  }, [queries]);

  return arrived;
}
