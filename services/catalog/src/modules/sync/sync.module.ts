import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';

/** The sync version and the delta-sync read (rdm-spec §1.7). */
@Module({
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
