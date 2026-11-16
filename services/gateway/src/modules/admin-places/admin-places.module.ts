import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { NarrationClientModule } from '../narration-client/narration-client.module';
import { IdentityModule } from '../identity/identity.module';
import { PeopleNamesModule } from '../people-names/people-names.module';
import { AdminPlacesController } from './admin-places.controller';
import { AdminPlacesService } from './admin-places.service';

/** `/admin/places`, backed by `catalog.PlaceAdminService`. */
@Module({
  imports: [CatalogModule, IdentityModule, NarrationClientModule, PeopleNamesModule],
  controllers: [AdminPlacesController],
  providers: [AdminPlacesService],
})
export class AdminPlacesModule {}
