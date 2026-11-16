import type { NotificationType } from '@wayfare/contracts';
import type { NotificationItem } from '@wayfare/contracts';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { fromOptionalProtoTimestamp, fromProtoTimestamp } from '@wayfare/nest-common';

/** A feed row whose type this build knows (the service filters the others out first). */
export function toNotificationItem(item: identityGrpc.NotificationItem): NotificationItem {
  return {
    id: item.id,
    type: item.type as NotificationType,
    data: JSON.parse(item.dataJson) as Record<string, unknown>,
    readAt: fromOptionalProtoTimestamp(item.readAt, 'readAt')?.toISOString() ?? null,
    createdAt: fromProtoTimestamp(item.createdAt, 'createdAt').toISOString(),
  };
}
