import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { OwnerBoostsModule } from '../owner-boosts/owner-boosts.module';
import { OwnerPlacesController } from './owner-places.controller';
import { OwnerPlacesService } from './owner-places.service';

/** `/owner/places`, backed by `catalog.OwnerPlaceService`. */
@Module({
  imports: [CatalogModule, OwnerBoostsModule],
  controllers: [OwnerPlacesController],
  providers: [OwnerPlacesService],
})
export class OwnerPlacesModule {}
