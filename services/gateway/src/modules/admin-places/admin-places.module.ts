import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { IdentityModule } from '../identity/identity.module';
import { AdminPlacesController } from './admin-places.controller';
import { AdminPlacesService } from './admin-places.service';

/** `/admin/places`, backed by `catalog.PlaceAdminService`. */
@Module({
  imports: [CatalogModule, IdentityModule],
  controllers: [AdminPlacesController],
  providers: [AdminPlacesService],
})
export class AdminPlacesModule {}
