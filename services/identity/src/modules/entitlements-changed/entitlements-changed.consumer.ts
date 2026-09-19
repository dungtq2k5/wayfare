import { Injectable } from '@nestjs/common';
import {
  BILLING_ENTITLEMENTS_CHANGED,
  EmailTemplate,
  narrowedDimensions,
  NotificationType,
} from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import { EmailDispatcher } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SERVICE_NAME } from '../outbox/outbox.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * `billing.entitlements.changed` → when something narrowed — a smaller numeric grant, lost
 * auto-narration or vouchers, a smaller language scope, a lower analytics level — the owner's
 * `ENTITLEMENTS_REDUCED` bell and email (api-endpoints-plan §10). A widening, or an account's first
 * grants, tell nobody. Keyed on the event. Durable `identity-billing-entitlements-changed`.
 */
@Injectable()
export class EntitlementsChangedConsumer extends JetStreamConsumer<
  typeof BILLING_ENTITLEMENTS_CHANGED
> {
  readonly event = BILLING_ENTITLEMENTS_CHANGED;
  readonly service: string = SERVICE_NAME;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly dispatcher: EmailDispatcher,
  ) {
    super();
  }

  async handle(payload: EventPayload<typeof BILLING_ENTITLEMENTS_CHANGED>): Promise<void> {
    if (payload.previous === null) return;
    const narrowing = narrowedDimensions(payload.previous, payload.entitlements);
    if (narrowing === null) return;
    const data = { entitlementsVersion: payload.entitlementsVersion, ...narrowing };
    const outcome = await this.prisma.$transaction(async (tx) => {
      const delivered = await this.notifications.deliver(tx, {
        recipientUserId: payload.ownerUserId,
        eventId: payload.eventId,
        notification: { type: NotificationType.ENTITLEMENTS_REDUCED, data },
      });
      if (!delivered.inserted && delivered.skipped !== undefined) return { delivered, mail: null };
      const mail = await this.email.prepare(tx, {
        template: EmailTemplate.ENTITLEMENTS_REDUCED,
        eventId: payload.eventId,
        recipient: { userId: payload.ownerUserId },
        data,
        links: { action: { path: 'ownerBilling' } },
        linkApp: 'console',
      });
      return { delivered, mail };
    });
    if (outcome.delivered.inserted) await this.notifications.announce(outcome.delivered.row);
    this.dispatcher.run([outcome.mail]);
  }
}
