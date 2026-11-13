import { Injectable, Logger } from '@nestjs/common';
import { IDENTITY_USER_ERASED } from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import { PaymentsProvider } from '../../providers/payments/payments-provider';
import { SERVICE_NAME } from '../outbox/outbox.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * `identity.user.erased` → the Stripe customer forgets the person (api-endpoints-plan §10): its
 * contact fields cleared and its payment methods detached, the customer and its invoices kept. The
 * billing account stays (rdm-spec B-3). Without a key there is nothing to reach; a Stripe failure
 * throws, so the event is redelivered. Durable `billing-identity-user-erased`.
 */
@Injectable()
export class UserErasedConsumer extends JetStreamConsumer<typeof IDENTITY_USER_ERASED> {
  readonly event = IDENTITY_USER_ERASED;
  readonly service: string = SERVICE_NAME;
  private readonly logger = new Logger(UserErasedConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsProvider,
  ) {
    super();
  }

  async handle(payload: EventPayload<typeof IDENTITY_USER_ERASED>): Promise<void> {
    const processed = await this.prisma.processedEvent.findUnique({
      where: { consumer_eventId: { consumer: this.durable, eventId: payload.eventId } },
      select: { eventId: true },
    });
    if (processed !== null) return;
    const account = await this.prisma.billingAccount.findUnique({
      where: { ownerUserId: payload.userId },
      select: { id: true, stripeCustomerId: true },
    });
    if (account?.stripeCustomerId != null) {
      if (this.payments.configured) {
        await this.payments.redactCustomer(account.stripeCustomerId);
        this.logger.log({ billingAccountId: account.id }, 'Stripe customer redacted');
      } else {
        this.logger.warn(
          { billingAccountId: account.id },
          'no Stripe key configured; the customer was not redacted',
        );
      }
    }
    await this.prisma.processedEvent.createMany({
      data: [{ consumer: this.durable, eventId: payload.eventId }],
      skipDuplicates: true,
    });
  }
}
