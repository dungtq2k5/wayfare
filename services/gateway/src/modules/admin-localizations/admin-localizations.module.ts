import { Module } from '@nestjs/common';
import { PeopleNamesModule } from '../people-names/people-names.module';
import { NarrationClientModule } from '../narration-client/narration-client.module';
import { AdminLocalizationsController } from './admin-localizations.controller';
import { AdminLocalizationsService } from './admin-localizations.service';

/** `/admin/narration/localizations` (api-endpoints-plan §4.5). */
@Module({
  imports: [NarrationClientModule, PeopleNamesModule],
  controllers: [AdminLocalizationsController],
  providers: [AdminLocalizationsService],
  exports: [AdminLocalizationsService],
})
export class AdminLocalizationsModule {}
