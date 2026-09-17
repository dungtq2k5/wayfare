import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { AdminPlacesController } from './admin-places.controller';
import { AdminPlacesService } from './admin-places.service';

/** `/admin/places`, backed by `catalog.PlaceAdminService`. */
@Module({
  imports: [CatalogModule],
  controllers: [AdminPlacesController],
  providers: [AdminPlacesService],
})
export class AdminPlacesModule {}
