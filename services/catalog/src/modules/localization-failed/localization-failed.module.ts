import { Module } from '@nestjs/common';
import { LocalizationsModule } from '../localizations/localizations.module';
import { LocalizationFailedConsumer } from './localization-failed.consumer';

/** The `narration.localization.failed` consumer. */
@Module({
  imports: [LocalizationsModule],
  providers: [LocalizationFailedConsumer],
  exports: [LocalizationFailedConsumer],
})
export class LocalizationFailedModule {}
