import { Module } from '@nestjs/common';
import { LocalizationsModule } from '../localizations/localizations.module';
import { LocalizationReadyConsumer } from './localization-ready.consumer';

/** The `narration.localization.ready` consumer. */
@Module({
  imports: [LocalizationsModule],
  providers: [LocalizationReadyConsumer],
  exports: [LocalizationReadyConsumer],
})
export class LocalizationReadyModule {}
