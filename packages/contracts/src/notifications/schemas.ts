import { z } from 'zod';
import { zUuidV7 } from '../common/ids';
import { zCursorQuery } from '../common/pagination';
import { zBooleanParam } from '../common/params';
import { NotificationType } from './types';

const zInstant = z.iso.datetime({ offset: true });

/**
 * One row of `GET /notifications` (api-endpoints-plan §1.7): the type and its data as stored; the
 * client renders the words (conventions §11.1).
 */
export const zNotificationItem = z
  .object({
    id: zUuidV7,
    type: z.enum(NotificationType),
    data: z.record(z.string(), z.unknown()),
    readAt: zInstant.nullable(),
    createdAt: zInstant,
  })
  .strict();
/** One feed row. */
export type NotificationItem = z.output<typeof zNotificationItem>;

/** `GET /notifications` query: cursor style, and unread rows only on request. */
export const zNotificationFeedQuery = zCursorQuery
  .extend({ unreadOnly: zBooleanParam.optional() })
  .strict();

/** `GET /notifications/unread-count`, and the `notification:unread-count` frame's shape. */
export const zUnreadCount = z.object({ count: z.number().int().min(0) }).strict();
