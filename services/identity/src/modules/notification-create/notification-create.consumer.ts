import { Injectable } from '@nestjs/common';
import { NOTIFICATION_CREATE } from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import { NotificationsService } from '../notifications/notifications.service';
import { SERVICE_NAME } from '../outbox/outbox.module';

/**
 * `notification.create` → one feed row (api-endpoints-plan §10). Durable
 * `identity-notification-create`; a redelivery hits the unique `(recipient, event)`.
 */
@Injectable()
export class NotificationCreateConsumer extends JetStreamConsumer<typeof NOTIFICATION_CREATE> {
  readonly event = NOTIFICATION_CREATE;
  readonly service: string = SERVICE_NAME;

  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  async handle(payload: EventPayload<typeof NOTIFICATION_CREATE>): Promise<void> {
    await this.notifications.deliverAndAnnounce({
      recipientUserId: payload.recipientUserId,
      eventId: payload.eventId,
      notification: payload.notification,
    });
  }
}
