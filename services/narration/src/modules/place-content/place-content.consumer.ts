import { Injectable } from '@nestjs/common';
import { CATALOG_PLACE_CONTENT_CHANGED } from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import { JobsService } from '../jobs/jobs.service';
import { SERVICE_NAME } from '../outbox/outbox.module';

/**
 * `catalog.place.content_changed` → a synthesis job for the Place (api-endpoints-plan §10).
 * Durable `narration-catalog-place-content-changed`.
 */
@Injectable()
export class PlaceContentConsumer extends JetStreamConsumer<typeof CATALOG_PLACE_CONTENT_CHANGED> {
  readonly event = CATALOG_PLACE_CONTENT_CHANGED;
  readonly service: string = SERVICE_NAME;

  constructor(private readonly jobs: JobsService) {
    super();
  }

  handle(payload: EventPayload<typeof CATALOG_PLACE_CONTENT_CHANGED>): Promise<void> {
    return this.jobs.fromPlaceContent(payload, this.durable);
  }
}
