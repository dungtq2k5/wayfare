import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { AdminAreasController } from './admin-areas.controller';
import { AdminAreasService } from './admin-areas.service';

/** `/admin/areas` (api-endpoints-plan §3.6). */
@Module({
  imports: [CatalogModule],
  controllers: [AdminAreasController],
  providers: [AdminAreasService],
})
export class AdminAreasModule {}
