import { Injectable, Logger } from '@nestjs/common';
import { BoostEndedReason, CATALOG_PLACE_STATUS_CHANGED, PlaceStatus } from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import { BoostsLedgerService } from '../boosts-ledger/boosts-ledger.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { SERVICE_NAME } from '../outbox/outbox.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * `catalog.place.status_changed` → a Venue that stopped being live, or was deleted, loses its
 * boost (`PLACE_UNAVAILABLE`, rdm-spec B-5), and its owner is told why. Idempotent: a boost ends
 * once, and a redelivery finds none live. A Venue becoming live again starts nothing — the owner
 * chooses it again. Durable `billing-catalog-place-status-changed`.
 */
@Injectable()
export class PlaceStatusConsumer extends JetStreamConsumer<typeof CATALOG_PLACE_STATUS_CHANGED> {
  readonly event = CATALOG_PLACE_STATUS_CHANGED;
  readonly service: string = SERVICE_NAME;
  private readonly logger = new Logger(PlaceStatusConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly ledger: BoostsLedgerService,
  ) {
    super();
  }

  async handle(payload: EventPayload<typeof CATALOG_PLACE_STATUS_CHANGED>): Promise<void> {
    if (payload.to === PlaceStatus.ACTIVE && !payload.deleted) return;
    const live = await this.prisma.discoveryBoost.findFirst({
      where: { placeId: payload.placeId, endsAt: null },
      select: { billingAccountId: true },
    });
    if (live === null) return;
    const ended = await this.prisma.$transaction(async (tx) => {
      const account = await this.entitlements.lockAccount(tx, { id: live.billingAccountId });
      if (account === null) return 0;
      const rows = (await this.ledger.live(tx, account.id)).filter(
        (row) => row.placeId === payload.placeId,
      );
      return this.ledger.end(tx, rows, BoostEndedReason.PLACE_UNAVAILABLE, new Date(), {
        ownerUserId: account.ownerUserId,
        planName: null,
        slots: account.discoveryBoostSlots,
        place: {
          placeInactiveReason: payload.deleted ? null : payload.reason,
          deleted: payload.deleted,
        },
      });
    });
    if (ended > 0) this.logger.log({ placeId: payload.placeId }, 'boost ended: the Venue left');
  }
}
