import { Injectable } from '@nestjs/common';
import { NARRATION_LOCALIZATION_READY } from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import { LocalizationsService } from '../localizations/localizations.service';
import { SERVICE_NAME } from '../outbox/outbox.module';

/**
 * `narration.localization.ready` → the read model and the activation gate (api-endpoints-plan §10).
 * Durable `catalog-narration-localization-ready`.
 */
@Injectable()
export class LocalizationReadyConsumer extends JetStreamConsumer<
  typeof NARRATION_LOCALIZATION_READY
> {
  readonly event = NARRATION_LOCALIZATION_READY;
  readonly service: string = SERVICE_NAME;

  constructor(private readonly localizations: LocalizationsService) {
    super();
  }

  handle(payload: EventPayload<typeof NARRATION_LOCALIZATION_READY>): Promise<void> {
    return this.localizations.applyReady(payload, this.durable);
  }
}
