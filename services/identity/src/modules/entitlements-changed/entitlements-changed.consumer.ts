import { Injectable } from '@nestjs/common';
import {
  BILLING_ENTITLEMENTS_CHANGED,
  derivedEventKey,
  EmailTemplate,
  EntitlementsChangeCause,
  narrowedDimensions,
  NotificationType,
  widenedDimensions,
} from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import { EmailDispatcher } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SERVICE_NAME } from '../outbox/outbox.module';
import { PrismaService } from '../prisma/prisma.service';

/** The causes whose raise the owner hears of: a person's action on their one account. */
const TOLD_RAISES: ReadonlySet<EntitlementsChangeCause> = new Set([
  EntitlementsChangeCause.OVERRIDE,
  EntitlementsChangeCause.UNPIN,
]);

/**
 * `billing.entitlements.changed` → when something narrowed — a smaller numeric grant, lost
 * auto-narration or vouchers, a smaller language scope, a lower analytics level — the owner's
 * `ENTITLEMENTS_REDUCED` bell and email (api-endpoints-plan §10), whatever the cause. When a staff
 * override or unpin widened something, `ENTITLEMENTS_RAISED` in the bell only; a plan applied to
 * every subscriber, or a purchase (`SUBSCRIPTION_ACTIVATED`), tells nobody of a raise. An account's
 * first grants tell nobody. Keyed on the event — the raise on a UUIDv5 of it, so an event that does
 * both inserts both. Durable `identity-billing-entitlements-changed`.
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
    await this.raised(payload, payload.previous);
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

  /** A staff action's raise: the bell only, keyed on its own id. */
  private async raised(
    payload: EventPayload<typeof BILLING_ENTITLEMENTS_CHANGED>,
    previous: NonNullable<EventPayload<typeof BILLING_ENTITLEMENTS_CHANGED>['previous']>,
  ): Promise<void> {
    if (!TOLD_RAISES.has(payload.cause)) return;
    const widening = widenedDimensions(previous, payload.entitlements);
    if (widening === null) return;
    const delivered = await this.prisma.$transaction((tx) =>
      this.notifications.deliver(tx, {
        recipientUserId: payload.ownerUserId,
        eventId: derivedEventKey(payload.eventId, NotificationType.ENTITLEMENTS_RAISED),
        notification: {
          type: NotificationType.ENTITLEMENTS_RAISED,
          data: { entitlementsVersion: payload.entitlementsVersion, ...widening },
        },
      }),
    );
    if (delivered.inserted) await this.notifications.announce(delivered.row);
  }
}
