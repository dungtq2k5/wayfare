import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

/** `/sync/places`, backed by `catalog.PlaceQueryService`. */
@Module({
  imports: [CatalogModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
