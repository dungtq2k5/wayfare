import { Module } from '@nestjs/common';
import { AreasService } from './areas.service';

/** The pilot areas' writes (rdm-spec C-3); the admin area route will land here. */
@Module({
  providers: [AreasService],
  exports: [AreasService],
})
export class AreasModule {}
