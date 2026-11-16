import { Injectable } from '@nestjs/common';
import { NotificationType } from '@wayfare/contracts';
import type { NotificationItem } from '@wayfare/contracts';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { Paged } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { IdentityServiceGrpcClient } from '../identity/identity-service-grpc.client';
import type { NotificationFeedQueryDto } from './dto/notification.dto';
import { toNotificationItem } from './notification.mapper';

const TYPES: readonly string[] = Object.values(NotificationType);

/** A row of a type this build knows, with object data; others are left out, as identity does. */
function isKnownItem(item: identityGrpc.NotificationItem): boolean {
  if (!TYPES.includes(item.type)) return false;
  try {
    const data: unknown = JSON.parse(item.dataJson);
    return typeof data === 'object' && data !== null && !Array.isArray(data);
  } catch {
    return false;
  }
}

/** `/notifications`, backed by `identity.NotificationService`. */
@Injectable()
export class NotificationsService {
  constructor(private readonly identity: IdentityServiceGrpcClient) {}

  async list(
    context: AccountContext,
    query: NotificationFeedQueryDto,
  ): Promise<Paged<NotificationItem>> {
    const response = await this.identity.notifications.call(
      'listNotifications',
      {
        page: {
          limit: query.limit,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        },
        unreadOnly: query.unreadOnly ?? false,
      },
      context,
    );
    return Paged.cursor(
      response.notifications.filter(isKnownItem).map(toNotificationItem),
      response.page?.nextCursor ?? null,
    );
  }

  async unreadCount(context: AccountContext): Promise<{ count: number }> {
    return this.identity.notifications.call('getUnreadCount', {}, context);
  }

  async markRead(context: AccountContext, notificationId: string): Promise<void> {
    await this.identity.notifications.call('markRead', { notificationId }, context);
  }

  async markAllRead(context: AccountContext): Promise<void> {
    await this.identity.notifications.call('markAllRead', {}, context);
  }
}
