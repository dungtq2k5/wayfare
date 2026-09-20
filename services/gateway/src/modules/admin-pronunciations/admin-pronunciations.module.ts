import { Module } from '@nestjs/common';
import { NarrationClientModule } from '../narration-client/narration-client.module';
import { AdminPronunciationsController } from './admin-pronunciations.controller';
import { AdminPronunciationsService } from './admin-pronunciations.service';

/** `/admin/narration/pronunciations` (api-endpoints-plan §4.4). */
@Module({
  imports: [NarrationClientModule],
  controllers: [AdminPronunciationsController],
  providers: [AdminPronunciationsService],
})
export class AdminPronunciationsModule {}
