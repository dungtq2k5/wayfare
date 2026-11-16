import { Injectable } from '@nestjs/common';
import {
  BILLING_SUBSCRIPTION_PAYMENT_FAILED,
  EmailTemplate,
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
 * `billing.subscription.payment_failed` → the owner's bell and a `PAYMENT_FAILED` email
 * (api-endpoints-plan §10), in one transaction. Both are keyed on the event, so a redelivery
 * writes neither twice; an owner who cannot receive gets neither. Durable
 * `identity-billing-subscription-payment-failed`.
 */
@Injectable()
export class PaymentFailedConsumer extends JetStreamConsumer<
  typeof BILLING_SUBSCRIPTION_PAYMENT_FAILED
> {
  readonly event = BILLING_SUBSCRIPTION_PAYMENT_FAILED;
  readonly service: string = SERVICE_NAME;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly dispatcher: EmailDispatcher,
  ) {
    super();
  }

  async handle(payload: EventPayload<typeof BILLING_SUBSCRIPTION_PAYMENT_FAILED>): Promise<void> {
    const data = {
      attemptCount: payload.attemptCount,
      ...(payload.nextAttemptAt === undefined ? {} : { nextAttemptAt: payload.nextAttemptAt }),
    };
    const outcome = await this.prisma.$transaction(async (tx) => {
      const delivered = await this.notifications.deliver(tx, {
        recipientUserId: payload.ownerUserId,
        eventId: payload.eventId,
        notification: { type: NotificationType.SUBSCRIPTION_PAYMENT_FAILED, data },
      });
      if (!delivered.inserted && delivered.skipped !== undefined) return { delivered, mail: null };
      const mail = await this.email.prepare(tx, {
        template: EmailTemplate.PAYMENT_FAILED,
        eventId: payload.eventId,
        recipient: { userId: payload.ownerUserId },
        data,
        links: {},
      });
      return { delivered, mail };
    });
    if (outcome.delivered.inserted) await this.notifications.announce(outcome.delivered.row);
    this.dispatcher.run([outcome.mail]);
  }
}
