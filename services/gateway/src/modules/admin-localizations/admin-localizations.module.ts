import { Module } from '@nestjs/common';
import { NarrationClientModule } from '../narration-client/narration-client.module';
import { AdminLocalizationsController } from './admin-localizations.controller';
import { AdminLocalizationsService } from './admin-localizations.service';

/** `/admin/narration/localizations` (api-endpoints-plan §4.5). */
@Module({
  imports: [NarrationClientModule],
  controllers: [AdminLocalizationsController],
  providers: [AdminLocalizationsService],
})
export class AdminLocalizationsModule {}
