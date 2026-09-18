// The notification feed (rdm-spec I-10, api-endpoints-plan §1.7): one write path, idempotent
// consumers, the caller's own rows only, and frames only for what changed.
import {
  CATALOG_PLACE_STATUS_CHANGED,
  compareStrings,
  newId,
  NOTIFICATION_CREATE,
  NotificationType,
  PlaceInactiveReason,
  PlaceStatus,
} from '@wayfare/contracts';
import type { EventPayload, Notification } from '@wayfare/contracts';
import { JobRunRecorder } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { buildAccountContext } from '@wayfare/nest-common/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NotificationCreateConsumer } from '../../src/modules/notification-create/notification-create.consumer';
import { PlaceStatusConsumer } from '../../src/modules/place-status/place-status.consumer';
import { NotificationsPruneJob } from '../../src/modules/scheduled/notifications-prune.job';
import { testPrisma, truncateAll } from '../setup/database';
import { errorCodeOf, freshEmail } from '../setup/fixtures';
import { identityServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof identityServices>;
let owner: AccountContext;

beforeEach(async () => {
  await truncateAll(prisma);
  services = identityServices(prisma);
  owner = await user();
});
afterAll(() => prisma.$disconnect());

async function user(
  overrides: { erasedAt?: Date; deletedAt?: Date } = {},
): Promise<AccountContext> {
  const row = await prisma.user.create({
    data: { email: freshEmail(), isEmailVerified: true, ...overrides },
    select: { id: true },
  });
  return buildAccountContext({ userId: row.id });
}

const edited = (placeId = newId()): Notification => ({
  type: NotificationType.PLACE_EDITED_BY_ADMIN,
  data: { placeId },
});

const create = (
  recipientUserId: string,
  notification: Notification = edited(),
  eventId = newId(),
) =>
  NOTIFICATION_CREATE.schema.parse({
    eventId,
    occurredAt: new Date().toISOString(),
    recipientUserId,
    notification,
  });

const statusChanged = (
  over: Partial<EventPayload<typeof CATALOG_PLACE_STATUS_CHANGED>>,
): EventPayload<typeof CATALOG_PLACE_STATUS_CHANGED> =>
  CATALOG_PLACE_STATUS_CHANGED.schema.parse({
    eventId: newId(),
    occurredAt: new Date().toISOString(),
    placeId: newId(),
    from: PlaceStatus.PROCESSING,
    to: PlaceStatus.ACTIVE,
    reason: null,
    deleted: false,
    ownerUserId: owner.userId,
    firstPublication: true,
    ...over,
  });

const feed = (
  context: AccountContext,
  over: { unreadOnly?: boolean; cursor?: string; limit?: number } = {},
) =>
  services.notifications.listNotifications(
    {
      page: {
        limit: over.limit ?? 20,
        ...(over.cursor === undefined ? {} : { cursor: over.cursor }),
      },
      unreadOnly: over.unreadOnly ?? false,
    },
    context,
  );

describe('delivering', () => {
  it('writes one row and one set of frames, however often the event is delivered', async () => {
    const consumer = new NotificationCreateConsumer(services.notifications);
    const event = create(owner.userId);
    await consumer.handle(event);
    await consumer.handle(event);
    expect(await prisma.notification.count()).toBe(1);
    const row = await prisma.notification.findFirstOrThrow();
    expect(row).toMatchObject({
      recipientUserId: owner.userId,
      eventId: event.eventId,
      type: 'PLACE_EDITED_BY_ADMIN',
      readAt: null,
    });
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
    expect(services.frames.frames).toEqual([
      {
        room: `user:${owner.userId}`,
        event: 'notificationNew',
        payload: {
          id: row.id,
          type: 'PLACE_EDITED_BY_ADMIN',
          data: event.notification.data,
          createdAt: row.createdAt.toISOString(),
        },
      },
      { room: `user:${owner.userId}`, event: 'notificationUnreadCount', payload: { count: 1 } },
    ]);
  });

  it('skips a missing or erased recipient, and still delivers to a deactivated one', async () => {
    const consumer = new NotificationCreateConsumer(services.notifications);
    await expect(consumer.handle(create(newId()))).resolves.toBeUndefined();
    const erased = await user({ deletedAt: new Date(), erasedAt: new Date() });
    await consumer.handle(create(erased.userId));
    expect(await prisma.notification.count()).toBe(0);
    const deactivated = await user({ deletedAt: new Date() });
    await consumer.handle(create(deactivated.userId));
    expect(
      await prisma.notification.count({ where: { recipientUserId: deactivated.userId } }),
    ).toBe(1);
  });

  it('refuses a notification whose data belongs to another type', async () => {
    await expect(
      services.notifications.deliverAndAnnounce({
        recipientUserId: owner.userId,
        eventId: newId(),
        notification: {
          type: NotificationType.PLACE_UNPUBLISHED,
          data: { placeId: newId() },
        } as never,
      }),
    ).rejects.toThrow();
  });
});

describe('catalog.place.status_changed', () => {
  it("notifies a Venue's owner once per transition, redelivered or late", async () => {
    const consumer = new PlaceStatusConsumer(services.notifications);
    const activated = statusChanged({});
    const unpublished = statusChanged({
      placeId: activated.placeId,
      from: PlaceStatus.ACTIVE,
      to: PlaceStatus.INACTIVE,
      reason: PlaceInactiveReason.ADMIN,
      firstPublication: false,
    });
    await consumer.handle(unpublished);
    await consumer.handle(activated);
    await consumer.handle(activated);
    const rows = await prisma.notification.findMany({ orderBy: { id: 'asc' } });
    expect(rows.map((row) => row.type)).toEqual(['PLACE_UNPUBLISHED', 'PLACE_ACTIVATED']);
    expect(rows[0]!.data).toEqual({ placeId: activated.placeId, reason: 'ADMIN' });
  });

  it('says nothing for a return to ACTIVE after an edit, nor for an Editorial Place', async () => {
    const consumer = new PlaceStatusConsumer(services.notifications);
    await consumer.handle(statusChanged({ firstPublication: false }));
    await consumer.handle(statusChanged({ ownerUserId: undefined }));
    expect(await prisma.notification.count()).toBe(0);
    expect(services.frames.frames).toEqual([]);
  });
});

describe('the feed', () => {
  it("lists the caller's own unexpired rows, newest first, a page at a time", async () => {
    const other = await user();
    for (let index = 0; index < 3; index++)
      await services.notifications.deliverAndAnnounce({
        recipientUserId: owner.userId,
        eventId: newId(),
        notification: edited(),
      });
    await services.notifications.deliverAndAnnounce({
      recipientUserId: other.userId,
      eventId: newId(),
      notification: edited(),
    });
    await prisma.notification.create({
      data: {
        id: newId(),
        recipientUserId: owner.userId,
        type: 'PLACE_EDITED_BY_ADMIN',
        data: { placeId: newId() },
        eventId: newId(),
        createdAt: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() - 1),
      },
    });

    const first = await feed(owner, { limit: 2 });
    expect(first.notifications).toHaveLength(2);
    expect(first.page?.nextCursor).toBeDefined();
    const second = await feed(owner, { limit: 2, cursor: first.page!.nextCursor! });
    expect(second.notifications).toHaveLength(1);
    expect(second.page?.nextCursor).toBeUndefined();
    const ids = [...first.notifications, ...second.notifications].map((item) => item.id);
    expect(ids).toEqual(ids.toSorted(compareStrings).reverse());
    expect(JSON.parse(first.notifications[0]!.dataJson)).toHaveProperty('placeId');
    expect(await services.notifications.getUnreadCount({}, owner)).toEqual({ count: 3 });
    expect(await errorCodeOf(feed(owner, { cursor: 'not-a-cursor' }))).toBe('VALIDATION_FAILED');
  });

  it('leaves out a row whose data no longer parses, and filters unread', async () => {
    await services.notifications.deliverAndAnnounce({
      recipientUserId: owner.userId,
      eventId: newId(),
      notification: edited(),
    });
    await prisma.notification.create({
      data: {
        id: newId(),
        recipientUserId: owner.userId,
        type: 'PLACE_EDITED_BY_ADMIN',
        data: { wrong: true },
        eventId: newId(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect((await feed(owner)).notifications).toHaveLength(1);
    await prisma.notification.updateMany({
      data: { readAt: new Date() },
      where: { data: { equals: { wrong: true } } },
    });
    expect((await feed(owner, { unreadOnly: true })).notifications).toHaveLength(1);
  });
});

describe('reading', () => {
  it('reads one row with frames, a second time without, and never another user’s', async () => {
    const { row } = (await services.notifications.deliverAndAnnounce({
      recipientUserId: owner.userId,
      eventId: newId(),
      notification: edited(),
    })) as { row: { id: string } };
    services.frames.frames.length = 0;
    expect(await services.notifications.markRead({ notificationId: row.id }, owner)).toEqual({});
    expect(services.frames.frames.map((frame) => [frame.event, frame.payload])).toEqual([
      ['notificationRead', { ids: [row.id] }],
      ['notificationUnreadCount', { count: 0 }],
    ]);
    await services.notifications.markRead({ notificationId: row.id }, owner);
    expect(services.frames.frames).toHaveLength(2);
    const stranger = await user();
    expect(
      await errorCodeOf(services.notifications.markRead({ notificationId: row.id }, stranger)),
    ).toBe('RESOURCE_NOT_FOUND');
    expect(
      await errorCodeOf(services.notifications.markRead({ notificationId: newId() }, owner)),
    ).toBe('RESOURCE_NOT_FOUND');
  });

  it('reads everything with one { all } frame, and nothing to read sends none', async () => {
    for (let index = 0; index < 2; index++)
      await services.notifications.deliverAndAnnounce({
        recipientUserId: owner.userId,
        eventId: newId(),
        notification: edited(),
      });
    services.frames.frames.length = 0;
    await services.notifications.markAllRead({}, owner);
    expect(services.frames.frames.map((frame) => [frame.event, frame.payload])).toEqual([
      ['notificationRead', { all: true }],
      ['notificationUnreadCount', { count: 0 }],
    ]);
    await services.notifications.markAllRead({}, owner);
    expect(services.frames.frames).toHaveLength(2);
  });
});

describe('retention', () => {
  it('prunes expired rows and records its run', async () => {
    await services.notifications.deliverAndAnnounce({
      recipientUserId: owner.userId,
      eventId: newId(),
      notification: edited(),
    });
    await prisma.notification.create({
      data: {
        id: newId(),
        recipientUserId: owner.userId,
        type: 'PLACE_EDITED_BY_ADMIN',
        data: { placeId: newId() },
        eventId: newId(),
        expiresAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    expect(await services.notifications.getUnreadCount({}, owner)).toEqual({ count: 1 });
    const job = new NotificationsPruneJob(prisma);
    const result = await new JobRunRecorder(prisma).track(job.name, () => job.run(new Date()));
    expect(result).toEqual({ deleted: 1 });
    expect(await prisma.notification.count()).toBe(1);
    expect(
      await prisma.jobRun.findUniqueOrThrow({ where: { jobName: 'notifications-prune' } }),
    ).toMatchObject({ consecutiveFailures: 0 });
  });

  it('the unread index is partial on unread rows', async () => {
    const [index] = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'notifications_unread_idx'`;
    expect(index!.indexdef).toMatch(
      /\(recipient_user_id, created_at DESC\) WHERE \(read_at IS NULL\)/,
    );
  });
});
