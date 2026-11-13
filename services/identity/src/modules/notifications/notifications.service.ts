import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  newId,
  NOTIFICATION_DATA,
  NOTIFICATION_RETENTION_DAYS,
  NotificationType as NotificationTypes,
  SOCKET_ROOMS,
  zCursorQuery,
  zNotification,
  zUuidV7,
} from '@wayfare/contracts';
import type { Notification, NotificationType } from '@wayfare/contracts';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import {
  decodeCursor,
  encodeCursor,
  parseRpcRequest,
  requireAccountContext,
  rpcError,
} from '@wayfare/nest-common';
import type { RequestContext, SocketEmitter } from '@wayfare/nest-common';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFICATION_SELECT, toNotificationItem } from './notification.mapper';
import type { NotificationRow } from './notification.mapper';

const TYPES: readonly string[] = Object.values(NotificationTypes);

/**
 * Whether a stored row still matches its type's data. One that does not is left out of the feed
 * rather than failing the page (rdm-spec I-10); the count still counts it until read or expired.
 */
function isReadableRow(row: NotificationRow): boolean {
  return (
    TYPES.includes(row.type) &&
    NOTIFICATION_DATA[row.type as NotificationType].safeParse(row.data).success
  );
}

/** Injection token for identity's socket emitter (conventions §7.4). */
export const SOCKET_EMITTER = Symbol('SOCKET_EMITTER');

/** What `deliver` is given: the recipient, the source event's id, and the notification. */
export interface DeliveryInput {
  readonly recipientUserId: string;
  readonly eventId: string;
  readonly notification: Notification;
}

/** An inserted row, as its frames need it. */
export interface DeliveredNotification {
  readonly recipientUserId: string;
  readonly id: string;
  readonly type: NotificationType;
  readonly data: Record<string, unknown>;
  readonly createdAt: Date;
}

/** What `deliver` did. */
export type DeliveryResult =
  | { readonly inserted: true; readonly row: DeliveredNotification }
  | { readonly inserted: false; readonly skipped?: 'RECIPIENT_UNAVAILABLE' };

const listFields = z.object({ page: zCursorQuery, unreadOnly: z.boolean() });
const markFields = z.object({ notificationId: zUuidV7 });

/**
 * The in-app feed (rdm-spec I-10, api-endpoints-plan §1.7). `deliver` is the one write path: every
 * consumer calls it, a redelivery hits the unique `(recipient, event)` and writes nothing, and the
 * frames go out only after the commit, only for a row actually inserted. Frames are
 * fire-and-forget — the feed is the record, and the last count frame wins.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SOCKET_EMITTER) private readonly emitter: Pick<SocketEmitter, 'toRoom'>,
  ) {}

  /** Inserts one notification inside the caller's transaction. */
  async deliver(tx: Prisma.TransactionClient, input: DeliveryInput): Promise<DeliveryResult> {
    const recipient = await tx.user.findUnique({
      where: { id: input.recipientUserId },
      select: { erasedAt: true },
    });
    if (recipient === null || recipient.erasedAt !== null) {
      // A missing user would redeliver forever; an erased one gains no new personal data.
      this.logger.warn(
        { recipientUserId: input.recipientUserId, eventId: input.eventId },
        'notification recipient unavailable; skipped',
      );
      return { inserted: false, skipped: 'RECIPIENT_UNAVAILABLE' };
    }
    const notification = zNotification.parse(input.notification);
    const id = newId();
    const [row] = await tx.$queryRaw<{ id: string; created_at: Date }[]>`
      INSERT INTO notifications (id, recipient_user_id, type, data, event_id, created_at, expires_at)
      VALUES (${id}::uuid, ${input.recipientUserId}::uuid, ${notification.type},
              ${JSON.stringify(notification.data)}::jsonb, ${input.eventId}::uuid, now(),
              now() + make_interval(days => ${NOTIFICATION_RETENTION_DAYS}))
      ON CONFLICT (recipient_user_id, event_id) DO NOTHING
      RETURNING id, created_at`;
    if (row === undefined) return { inserted: false };
    return {
      inserted: true,
      row: {
        recipientUserId: input.recipientUserId,
        id: row.id,
        type: notification.type,
        data: notification.data,
        createdAt: row.created_at,
      },
    };
  }

  /** `deliver` in its own transaction, then the frames: what a consumer calls. */
  async deliverAndAnnounce(input: DeliveryInput): Promise<DeliveryResult> {
    const result = await this.prisma.$transaction((tx) => this.deliver(tx, input));
    if (result.inserted) await this.announce(result.row);
    return result;
  }

  /** After the commit: the new row, then the count read now, so it includes it. */
  async announce(row: DeliveredNotification): Promise<void> {
    this.frame(() =>
      this.emitter.toRoom(SOCKET_ROOMS.user(row.recipientUserId), 'notificationNew', {
        id: row.id,
        type: row.type,
        data: row.data,
        createdAt: row.createdAt.toISOString(),
      }),
    );
    await this.announceCount(row.recipientUserId);
  }

  async listNotifications(
    request: identityGrpc.ListNotificationsRequest,
    context: RequestContext,
  ): Promise<identityGrpc.ListNotificationsResponse> {
    const actor = requireAccountContext(context);
    const fields = parseRpcRequest(listFields, request);
    const after = fields.page.cursor === undefined ? null : decodeCursor(fields.page.cursor);
    if (fields.page.cursor !== undefined && after === null) {
      throw rpcError('VALIDATION_FAILED', {
        issues: [{ path: '/page/cursor', code: 'invalid_format' }],
      });
    }
    const rows = await this.prisma.notification.findMany({
      where: {
        recipientUserId: actor.userId,
        expiresAt: { gt: new Date() },
        ...(fields.unreadOnly ? { readAt: null } : {}),
        ...(after === null ? {} : { id: { lt: after.id } }),
      },
      // UUID v7 ids sort by creation time: the keyset is the id alone.
      orderBy: { id: 'desc' },
      take: fields.page.limit + 1,
      select: NOTIFICATION_SELECT,
    });
    const page = rows.slice(0, fields.page.limit);
    const readable = page.filter((row) => {
      if (isReadableRow(row)) return true;
      this.logger.warn(
        { notificationId: row.id, type: row.type },
        'unreadable notification left out',
      );
      return false;
    });
    const last = page.at(-1);
    return {
      notifications: readable.map(toNotificationItem),
      page: {
        ...(rows.length > fields.page.limit && last !== undefined
          ? { nextCursor: encodeCursor({ id: last.id }) }
          : {}),
      },
    };
  }

  async getUnreadCount(
    _request: identityGrpc.GetUnreadCountRequest,
    context: RequestContext,
  ): Promise<identityGrpc.GetUnreadCountResponse> {
    const actor = requireAccountContext(context);
    return { count: await this.unread(actor.userId) };
  }

  /** Reads one row; another user's or a missing one is `RESOURCE_NOT_FOUND`, a read one a no-op. */
  async markRead(
    request: identityGrpc.MarkReadRequest,
    context: RequestContext,
  ): Promise<identityGrpc.MarkReadResponse> {
    const actor = requireAccountContext(context);
    const { notificationId } = parseRpcRequest(markFields, request);
    const { count } = await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientUserId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (count === 0) {
      const mine = await this.prisma.notification.findFirst({
        where: { id: notificationId, recipientUserId: actor.userId },
        select: { id: true },
      });
      if (mine === null) throw rpcError('RESOURCE_NOT_FOUND', { resource: 'NOTIFICATION' });
      return {};
    }
    this.frame(() =>
      this.emitter.toRoom(SOCKET_ROOMS.user(actor.userId), 'notificationRead', {
        ids: [notificationId],
      }),
    );
    await this.announceCount(actor.userId);
    return {};
  }

  async markAllRead(
    _request: identityGrpc.MarkAllReadRequest,
    context: RequestContext,
  ): Promise<identityGrpc.MarkAllReadResponse> {
    const actor = requireAccountContext(context);
    const { count } = await this.prisma.notification.updateMany({
      where: { recipientUserId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (count > 0) {
      // A frame can list only a page of ids: the other tabs are told everything is read.
      this.frame(() =>
        this.emitter.toRoom(SOCKET_ROOMS.user(actor.userId), 'notificationRead', { all: true }),
      );
      await this.announceCount(actor.userId);
    }
    return {};
  }

  /** Unread and unexpired — the partial index `notifications_unread_idx`. */
  unread(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { recipientUserId: userId, readAt: null, expiresAt: { gt: new Date() } },
    });
  }

  private async announceCount(userId: string): Promise<void> {
    try {
      const count = await this.unread(userId);
      this.frame(() =>
        this.emitter.toRoom(SOCKET_ROOMS.user(userId), 'notificationUnreadCount', { count }),
      );
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error.message : 'unknown' },
        'count frame lost',
      );
    }
  }

  /** A frame never fails the write it follows. */
  private frame(send: () => void): void {
    try {
      send();
    } catch (error) {
      this.logger.warn({ err: error instanceof Error ? error.message : 'unknown' }, 'frame lost');
    }
  }
}
