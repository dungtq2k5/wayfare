import { Injectable } from '@nestjs/common';
import { IDENTITY_DEVICE_CLAIMED } from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import { FavoritesService } from '../favorites/favorites.service';
import { SERVICE_NAME } from '../outbox/outbox.module';

/**
 * `identity.device.claimed` → a claimed device's saved Places become the
 * account's, so its other devices see them (api-endpoints-plan §10,
 * rdm-spec C-13). Once per event through `processed_events`. Durable `catalog-identity-device-claimed`.
 */
@Injectable()
export class DeviceClaimedConsumer extends JetStreamConsumer<typeof IDENTITY_DEVICE_CLAIMED> {
  readonly event = IDENTITY_DEVICE_CLAIMED;
  readonly service: string = SERVICE_NAME;

  constructor(private readonly favorites: FavoritesService) {
    super();
  }

  handle(payload: EventPayload<typeof IDENTITY_DEVICE_CLAIMED>): Promise<void> {
    return this.favorites.claimDevice(payload, this.durable);
  }
}
