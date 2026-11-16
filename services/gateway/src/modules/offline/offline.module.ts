import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { OfflineController } from './offline.controller';
import { OfflineService } from './offline.service';

/** `/offline` (api-endpoints-plan §2.4). */
@Module({
  imports: [CatalogModule],
  controllers: [OfflineController],
  providers: [OfflineService],
})
export class OfflineModule {}
