import { Injectable, Logger } from '@nestjs/common';
import { BILLING_BOOSTS_CHANGED } from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import { SERVICE_NAME } from '../outbox/outbox.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * `billing.boosts.changed` → `places.discovery_boost`, the only writer of that column (rdm-spec
 * C-1). Applied only when newer than the change it last applied (`discovery_boost_changed_at`,
 * conventions §6): order across a Place's events isn't guaranteed, and a late `0` must not undo a
 * newer start. Neither `sync_version` nor `updated_at` moves: the boost never reaches a device's
 * data, so it can't reach narration (ADR 0007). A deleted or Editorial Place is left alone — the
 * column's own check refuses an Editorial boost besides. Durable `catalog-billing-boosts-changed`.
 */
@Injectable()
export class BoostsChangedConsumer extends JetStreamConsumer<typeof BILLING_BOOSTS_CHANGED> {
  readonly event = BILLING_BOOSTS_CHANGED;
  readonly service: string = SERVICE_NAME;
  private readonly logger = new Logger(BoostsChangedConsumer.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async handle(payload: EventPayload<typeof BILLING_BOOSTS_CHANGED>): Promise<void> {
    const changedAt = new Date(payload.changedAt);
    const applied = await this.prisma.$executeRaw`
      UPDATE places
      SET discovery_boost = ${payload.discoveryBoost}, discovery_boost_changed_at = ${changedAt}
      WHERE id = ${payload.placeId}::uuid
        AND kind = 'VENUE'
        AND deleted_at IS NULL
        AND (discovery_boost_changed_at IS NULL OR discovery_boost_changed_at < ${changedAt})`;
    if (applied === 0) {
      this.logger.log(
        { placeId: payload.placeId, changedAt: payload.changedAt },
        'boost change not applied: older than the last, or no live Venue',
      );
    }
  }
}
