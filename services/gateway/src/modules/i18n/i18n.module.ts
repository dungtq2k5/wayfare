import { Module } from '@nestjs/common';
import { NarrationClientModule } from '../narration-client/narration-client.module';
import { I18nController } from './i18n.controller';
import { I18nService } from './i18n.service';

/** `/i18n/bundles` (api-endpoints-plan §4.2). */
@Module({
  imports: [NarrationClientModule],
  controllers: [I18nController],
  providers: [I18nService],
})
export class I18nModule {}
