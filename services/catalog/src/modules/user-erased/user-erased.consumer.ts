import { Injectable } from '@nestjs/common';
import { IDENTITY_USER_ERASED } from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import { SERVICE_NAME } from '../outbox/outbox.module';
import { PlacesService } from '../places/places.service';

/**
 * `identity.user.erased` → an erased owner's Venues stop narrating (api-endpoints-plan §10): the
 * published and waiting ones go `INACTIVE (OWNER)`, the drafts are soft-deleted. Idempotent
 * through `processed_events`. Durable `catalog-identity-user-erased`.
 */
@Injectable()
export class UserErasedConsumer extends JetStreamConsumer<typeof IDENTITY_USER_ERASED> {
  readonly event = IDENTITY_USER_ERASED;
  readonly service: string = SERVICE_NAME;

  constructor(private readonly places: PlacesService) {
    super();
  }

  handle(payload: EventPayload<typeof IDENTITY_USER_ERASED>): Promise<void> {
    return this.places.retireErasedOwner(payload, this.durable);
  }
}
