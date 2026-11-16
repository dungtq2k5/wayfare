import { Injectable } from '@nestjs/common';
import { CATALOG_TOUR_CONTENT_CHANGED } from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import { JobsService } from '../jobs/jobs.service';
import { SERVICE_NAME } from '../outbox/outbox.module';

/**
 * `catalog.tour.content_changed` → a text-only job for the tour (api-endpoints-plan §10).
 * Durable `narration-catalog-tour-content-changed`.
 */
@Injectable()
export class TourContentConsumer extends JetStreamConsumer<typeof CATALOG_TOUR_CONTENT_CHANGED> {
  readonly event = CATALOG_TOUR_CONTENT_CHANGED;
  readonly service: string = SERVICE_NAME;

  constructor(private readonly jobs: JobsService) {
    super();
  }

  handle(payload: EventPayload<typeof CATALOG_TOUR_CONTENT_CHANGED>): Promise<void> {
    return this.jobs.fromTourContent(payload, this.durable);
  }
}
