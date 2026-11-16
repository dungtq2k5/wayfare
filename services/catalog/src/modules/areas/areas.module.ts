import { Module } from '@nestjs/common';
import { AreasService } from './areas.service';

/** The areas (rdm-spec C-3): their writes, for the admin routes and the seeds, and their admin reads. */
@Module({
  providers: [AreasService],
  exports: [AreasService],
})
export class AreasModule {}
