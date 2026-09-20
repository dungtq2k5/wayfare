import { Injectable } from '@nestjs/common';
import { IDENTITY_DEVICE_FORGOTTEN } from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import { FavoritesService } from '../favorites/favorites.service';
import { SERVICE_NAME } from '../outbox/outbox.module';

/**
 * `identity.device.forgotten` → a forgotten device's saved Places are deleted (api-endpoints-plan §10,
 * rdm-spec C-13). Once per event through `processed_events`. Durable `catalog-identity-device-forgotten`.
 */
@Injectable()
export class DeviceForgottenConsumer extends JetStreamConsumer<typeof IDENTITY_DEVICE_FORGOTTEN> {
  readonly event = IDENTITY_DEVICE_FORGOTTEN;
  readonly service: string = SERVICE_NAME;

  constructor(private readonly favorites: FavoritesService) {
    super();
  }

  handle(payload: EventPayload<typeof IDENTITY_DEVICE_FORGOTTEN>): Promise<void> {
    return this.favorites.forgetDevice(payload, this.durable);
  }
}
