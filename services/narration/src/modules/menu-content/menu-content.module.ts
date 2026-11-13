import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { MenuContentConsumer } from './menu-content.consumer';

/** The `catalog.menu.content_changed` consumer. */
@Module({
  imports: [JobsModule],
  providers: [MenuContentConsumer],
  exports: [MenuContentConsumer],
})
export class MenuContentModule {}
