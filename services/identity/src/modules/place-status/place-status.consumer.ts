import { Injectable } from '@nestjs/common';
import { CATALOG_PLACE_STATUS_CHANGED } from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import { NotificationsService } from '../notifications/notifications.service';
import { SERVICE_NAME } from '../outbox/outbox.module';
import { placeStatusNotification } from './domain/place-status-notification';

/**
 * `catalog.place.status_changed` → a Venue owner's notification (api-endpoints-plan §10). Durable
 * `identity-catalog-place-status-changed`. The row's event id is this event's, so a redelivery is
 * a no-op; every transition is its own notification, even one delivered late.
 */
@Injectable()
export class PlaceStatusConsumer extends JetStreamConsumer<typeof CATALOG_PLACE_STATUS_CHANGED> {
  readonly event = CATALOG_PLACE_STATUS_CHANGED;
  readonly service: string = SERVICE_NAME;

  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  async handle(payload: EventPayload<typeof CATALOG_PLACE_STATUS_CHANGED>): Promise<void> {
    const notification = placeStatusNotification(payload);
    if (notification === null || payload.ownerUserId === undefined) return;
    await this.notifications.deliverAndAnnounce({
      recipientUserId: payload.ownerUserId,
      eventId: payload.eventId,
      notification,
    });
  }
}
