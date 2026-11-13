import { Module } from '@nestjs/common';
import { PeopleNamesModule } from '../people-names/people-names.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AdminMapPacksController } from './admin-map-packs.controller';
import { AdminMapPacksService } from './admin-map-packs.service';

/** `/admin/map-packs` (api-endpoints-plan §3.6). */
@Module({
  imports: [CatalogModule, PeopleNamesModule],
  controllers: [AdminMapPacksController],
  providers: [AdminMapPacksService],
})
export class AdminMapPacksModule {}
