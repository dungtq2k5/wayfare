import { Injectable } from '@nestjs/common';
import { IDENTITY_USER_ERASED } from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import { FavoritesService } from '../favorites/favorites.service';
import { SERVICE_NAME } from '../outbox/outbox.module';
import { PlacesService } from '../places/places.service';

/**
 * `identity.user.erased` (api-endpoints-plan §10): the account's favourites lose their `user_id`
 * and stay with their devices; an erased owner's Venues stop narrating — the published and
 * waiting ones go `INACTIVE (OWNER)`, the drafts are soft-deleted. Idempotent: clearing twice
 * changes nothing, and the Venues through `processed_events`. Durable
 * `catalog-identity-user-erased`.
 */
@Injectable()
export class UserErasedConsumer extends JetStreamConsumer<typeof IDENTITY_USER_ERASED> {
  readonly event = IDENTITY_USER_ERASED;
  readonly service: string = SERVICE_NAME;

  constructor(
    private readonly places: PlacesService,
    private readonly favorites: FavoritesService,
  ) {
    super();
  }

  async handle(payload: EventPayload<typeof IDENTITY_USER_ERASED>): Promise<void> {
    await this.favorites.eraseUser(payload);
    await this.places.retireErasedOwner(payload, this.durable);
  }
}
