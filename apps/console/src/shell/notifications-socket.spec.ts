// @vitest-environment happy-dom
import type { InfiniteData } from '@tanstack/react-query';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedNotification } from '../notifications/text';
import { renderHook } from '@wayfare/ui/testing';

/** The socket's handlers by event, as the hook registers them; the test delivers the events. */
const socket = vi.hoisted(() => ({ handlers: new Map<string, (payload: unknown) => void>() }));
vi.mock('./socket', () => ({
  useSocketEvent: (event: string, handler: (payload: unknown) => void) => {
    socket.handlers.set(event, handler);
  },
}));

const { FEED_KEY, UNREAD_KEY, useNotificationSocket } = await import('./notifications-socket');
type Feed = InfiniteData<{ data: FeedNotification[]; meta: { nextCursor: string | null } }>;

const row = (id: string, readAt: string | null = null): FeedNotification => ({
  id,
  type: 'PLACE_ACTIVATED',
  data: {},
  readAt,
  createdAt: '2026-11-01T00:00:00Z',
});
const deliver = (event: string, payload: unknown) =>
  act(() => socket.handlers.get(event)!(payload));
const feedOf = (pages: FeedNotification[][]): Feed => ({
  pages: pages.map((data) => ({ data, meta: { nextCursor: null } })),
  pageParams: pages.map(() => null),
});

describe('the notifications on the shell’s socket (K10)', () => {
  beforeEach(() => socket.handlers.clear());

  it('takes the unread count from the server, never counting itself', async () => {
    const rendered = await renderHook(() => useNotificationSocket());
    deliver('notificationUnreadCount', { count: 4 });
    expect(rendered.queries.getQueryData(UNREAD_KEY)).toBe(4);
  });

  it('puts a new notification first, once, and announces it', async () => {
    const rendered = await renderHook(() => useNotificationSocket());
    rendered.queries.setQueryData(FEED_KEY, feedOf([[row('a')], [row('b')]]));
    const { readAt: _, ...payload } = row('n');
    deliver('notificationNew', payload);
    deliver('notificationNew', payload);
    const feed = rendered.queries.getQueryData<Feed>(FEED_KEY)!;
    expect(feed.pages.map((page) => page.data.map((item) => item.id))).toEqual([['n', 'a'], ['b']]);
    expect(rendered.current()).toEqual(row('n'));
  });

  it('announces a new one with no feed loaded, keeping the feed unread', async () => {
    const rendered = await renderHook(() => useNotificationSocket());
    deliver('notificationNew', row('n'));
    expect(rendered.queries.getQueryData(FEED_KEY)).toBeUndefined();
    rendered.queries.setQueryData(FEED_KEY, feedOf([]));
    deliver('notificationNew', row('m'));
    expect(rendered.queries.getQueryData<Feed>(FEED_KEY)!.pages).toEqual([]);
    expect(rendered.current()?.id).toBe('m');
  });

  it('marks the rows read, by id or all, keeping an earlier read time', async () => {
    const rendered = await renderHook(() => useNotificationSocket());
    deliver('notificationRead', { all: true });
    expect(rendered.queries.getQueryData(FEED_KEY)).toBeUndefined();
    const earlier = '2026-10-01T00:00:00Z';
    rendered.queries.setQueryData(FEED_KEY, feedOf([[row('a'), row('b'), row('c', earlier)]]));
    deliver('notificationRead', { ids: ['a'] });
    const reads = () =>
      rendered.queries.getQueryData<Feed>(FEED_KEY)!.pages[0]!.data.map((item) => item.readAt);
    expect(reads()[0]).not.toBeNull();
    expect(reads().slice(1)).toEqual([null, earlier]);
    deliver('notificationRead', { all: true });
    expect(reads().every((readAt) => readAt !== null)).toBe(true);
    expect(reads()[2]).toBe(earlier);
  });
});
