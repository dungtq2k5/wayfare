import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { PlaceContentConsumer } from './place-content.consumer';

/** The `catalog.place.content_changed` consumer. */
@Module({
  imports: [JobsModule],
  providers: [PlaceContentConsumer],
  exports: [PlaceContentConsumer],
})
export class PlaceContentModule {}
