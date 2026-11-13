import { Injectable } from '@nestjs/common';
import { BILLING_BOOST_ENDED, BoostEndedReason, NotificationType } from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import { NotificationsService } from '../notifications/notifications.service';
import { SERVICE_NAME } from '../outbox/outbox.module';

/**
 * `billing.boost.ended` → `BOOST_ENDED` in the owner's bell (api-endpoints-plan §10), for a Venue
 * that stopped being live only: fewer slots (`ENTITLEMENT_LIMIT`) already send the plan change's
 * `ENTITLEMENTS_REDUCED`, and *Plan and billing* names the ended boost. Bell only, no email. An
 * erased owner gets nothing (`deliver` checks). Durable `identity-billing-boost-ended`; the row's
 * event id is this event's, so a redelivery is a no-op.
 */
@Injectable()
export class BoostEndedConsumer extends JetStreamConsumer<typeof BILLING_BOOST_ENDED> {
  readonly event = BILLING_BOOST_ENDED;
  readonly service: string = SERVICE_NAME;

  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  async handle(payload: EventPayload<typeof BILLING_BOOST_ENDED>): Promise<void> {
    if (payload.reason !== BoostEndedReason.PLACE_UNAVAILABLE) return;
    await this.notifications.deliverAndAnnounce({
      recipientUserId: payload.ownerUserId,
      eventId: payload.eventId,
      notification: {
        type: NotificationType.BOOST_ENDED,
        data: {
          placeId: payload.placeId,
          reason: BoostEndedReason.PLACE_UNAVAILABLE,
          placeInactiveReason: payload.placeInactiveReason,
          deleted: payload.deleted,
        },
      },
    });
  }
}
