import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { TourContentConsumer } from './tour-content.consumer';

/** The `catalog.tour.content_changed` consumer. */
@Module({
  imports: [JobsModule],
  providers: [TourContentConsumer],
  exports: [TourContentConsumer],
})
export class TourContentModule {}
