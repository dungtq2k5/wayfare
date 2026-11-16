import { Module } from '@nestjs/common';
import { PeopleNamesModule } from '../people-names/people-names.module';
import { NarrationClientModule } from '../narration-client/narration-client.module';
import { AdminPronunciationsController } from './admin-pronunciations.controller';
import { AdminPronunciationsService } from './admin-pronunciations.service';

/** `/admin/narration/pronunciations` (api-endpoints-plan §4.4). */
@Module({
  imports: [NarrationClientModule, PeopleNamesModule],
  controllers: [AdminPronunciationsController],
  providers: [AdminPronunciationsService],
})
export class AdminPronunciationsModule {}
