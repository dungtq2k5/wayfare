import { Injectable } from '@nestjs/common';
import { BILLING_ENTITLEMENTS_CHANGED } from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import { SERVICE_NAME } from '../outbox/outbox.module';
import { PlacesService } from '../places/places.service';

/**
 * `billing.entitlements.changed` → the owner's Venues follow their grants (api-endpoints-plan §10):
 * auto-narration, the place limit both ways, newly covered languages. Guarded by the version kept
 * in `owner_entitlements`. Durable `catalog-billing-entitlements-changed`.
 */
@Injectable()
export class EntitlementsChangedConsumer extends JetStreamConsumer<
  typeof BILLING_ENTITLEMENTS_CHANGED
> {
  readonly event = BILLING_ENTITLEMENTS_CHANGED;
  readonly service: string = SERVICE_NAME;

  constructor(private readonly places: PlacesService) {
    super();
  }

  handle(payload: EventPayload<typeof BILLING_ENTITLEMENTS_CHANGED>): Promise<void> {
    return this.places.applyEntitlements(payload);
  }
}
