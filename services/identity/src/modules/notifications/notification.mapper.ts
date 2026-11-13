import type { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import type { Prisma } from '../../../generated/prisma/client';

/** The columns a feed row reads (rdm-spec I-10). */
export const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  data: true,
  readAt: true,
  createdAt: true,
} as const satisfies Prisma.NotificationSelect;

/** A notification row as selected. */
export type NotificationRow = Prisma.NotificationGetPayload<{ select: typeof NOTIFICATION_SELECT }>;

/** A feed row as the RPC returns it; `data` travels as JSON. */
export function toNotificationItem(row: NotificationRow): identityGrpc.NotificationItem {
  return {
    id: row.id,
    type: row.type,
    dataJson: JSON.stringify(row.data),
    readAt: row.readAt === null ? undefined : toProtoTimestamp(row.readAt),
    createdAt: toProtoTimestamp(row.createdAt),
  };
}
