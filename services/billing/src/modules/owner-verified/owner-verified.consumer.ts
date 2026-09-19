import { Injectable, Logger } from '@nestjs/common';
import { IDENTITY_OWNER_VERIFIED } from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { SERVICE_NAME } from '../outbox/outbox.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * `identity.owner.verified` → a `FREE` billing account and its first grants (api-endpoints-plan
 * §10). Idempotent through the account's unique owner. Durable `billing-identity-owner-verified`,
 * delivered from the stream's start, so owners verified before billing existed get theirs.
 */
@Injectable()
export class OwnerVerifiedConsumer extends JetStreamConsumer<typeof IDENTITY_OWNER_VERIFIED> {
  readonly event = IDENTITY_OWNER_VERIFIED;
  readonly service: string = SERVICE_NAME;
  private readonly logger = new Logger(OwnerVerifiedConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {
    super();
  }

  async handle(payload: EventPayload<typeof IDENTITY_OWNER_VERIFIED>): Promise<void> {
    const opened = await this.prisma.$transaction((tx) =>
      this.entitlements.openFreeAccount(tx, payload.userId, new Date()),
    );
    if (opened) this.logger.log({ ownerUserId: payload.userId }, 'billing account opened');
  }
}
