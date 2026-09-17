import { Injectable } from '@nestjs/common';
import { NARRATION_LOCALIZATION_FAILED } from '@wayfare/contracts';
import type { EventPayload } from '@wayfare/contracts';
import { JetStreamConsumer } from '@wayfare/nest-common';
import { LocalizationsService } from '../localizations/localizations.service';
import { SERVICE_NAME } from '../outbox/outbox.module';

/**
 * `narration.localization.failed` → a final failure marks the audio `FAILED` (api-endpoints-plan
 * §10). Idempotent by construction: the update only ever moves a row to `FAILED`. Durable
 * `catalog-narration-localization-failed`.
 */
@Injectable()
export class LocalizationFailedConsumer extends JetStreamConsumer<
  typeof NARRATION_LOCALIZATION_FAILED
> {
  readonly event = NARRATION_LOCALIZATION_FAILED;
  readonly service: string = SERVICE_NAME;

  constructor(private readonly localizations: LocalizationsService) {
    super();
  }

  handle(payload: EventPayload<typeof NARRATION_LOCALIZATION_FAILED>): Promise<void> {
    return this.localizations.applyFailed(payload);
  }
}
