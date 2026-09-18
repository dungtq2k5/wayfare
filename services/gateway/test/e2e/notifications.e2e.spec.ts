import { status } from '@grpc/grpc-js';
import { newId } from '@wayfare/contracts';
import { toProtoTimestamp } from '@wayfare/nest-common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway, serviceError } from '../support/app';
import type { E2eApp } from '../support/app';

let gateway: E2eApp;
const userId = newId();
const placeId = newId();
const notificationId = newId();

function console_(method: 'get' | 'post', path: string) {
  const agent = request(gateway.app.getHttpServer());
  return agent[method](`/api/v1${path}`)
    .set('X-Wayfare-Client', 'console')
    .set('Cookie', `wf_at=${accountToken({ userId })}`);
}

beforeAll(async () => {
  gateway = await bootGateway();
});
afterAll(() => gateway.app.close());
beforeEach(() => gateway.identity.reset());

describe('/notifications', () => {
  it('lists the feed with its cursor, decoding each row’s data', async () => {
    gateway.identity.notifications.handlers.listNotifications = () =>
      Promise.resolve({
        notifications: [
          {
            id: notificationId,
            type: 'PLACE_EDITED_BY_ADMIN',
            dataJson: JSON.stringify({ placeId }),
            readAt: undefined,
            createdAt: toProtoTimestamp(new Date('2026-09-18T08:00:00Z')),
          },
          // A type this build does not know is left out.
          {
            id: newId(),
            type: 'FROM_THE_FUTURE',
            dataJson: '{}',
            readAt: undefined,
            createdAt: toProtoTimestamp(new Date()),
          },
        ],
        page: { nextCursor: 'next' },
      });
    const res = await console_('get', '/notifications?unreadOnly=true&limit=10');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body).toEqual({
      data: [
        {
          id: notificationId,
          type: 'PLACE_EDITED_BY_ADMIN',
          data: { placeId },
          readAt: null,
          createdAt: '2026-09-18T08:00:00.000Z',
        },
      ],
      meta: { nextCursor: 'next' },
    });
    expect(gateway.identity.notifications.calls[0]!.request).toEqual({
      page: { limit: 10 },
      unreadOnly: true,
    });
  });

  it('answers the unread count', async () => {
    gateway.identity.notifications.handlers.getUnreadCount = () => Promise.resolve({ count: 3 });
    const res = await console_('get', '/notifications/unread-count');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ count: 3 });
  });

  it('reads one and reads all with 204', async () => {
    gateway.identity.notifications.handlers.markRead = () => Promise.resolve({});
    gateway.identity.notifications.handlers.markAllRead = () => Promise.resolve({});
    const one = await console_('post', `/notifications/${notificationId}/read`);
    expect(one.status).toBe(204);
    expect(gateway.identity.notifications.calls[0]!.request).toEqual({ notificationId });
    const all = await console_('post', '/notifications/read-all');
    expect(all.status).toBe(204);
  });

  it("answers 404 for another user's notification", async () => {
    gateway.identity.notifications.handlers.markRead = () =>
      Promise.reject(serviceError(status.NOT_FOUND, { 'wf-error-code': 'RESOURCE_NOT_FOUND' }));
    const res = await console_('post', `/notifications/${newId()}/read`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('needs a signed-in account', async () => {
    const res = await request(gateway.app.getHttpServer())
      .get('/api/v1/notifications')
      .set('X-Wayfare-Client', 'console');
    expect(res.status).toBe(401);
  });
});
