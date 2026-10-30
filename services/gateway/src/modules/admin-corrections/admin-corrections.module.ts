import { Module } from '@nestjs/common';
import { AdminLocalizationsModule } from '../admin-localizations/admin-localizations.module';
import { AdminCorrectionsController } from './admin-corrections.controller';

/** `/admin/narration/corrections` (api-endpoints-plan §4.5): read through the localizations' service. */
@Module({
  imports: [AdminLocalizationsModule],
  controllers: [AdminCorrectionsController],
})
export class AdminCorrectionsModule {}
