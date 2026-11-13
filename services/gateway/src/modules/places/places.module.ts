import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { PlacesController } from './places.controller';
import { PlacesService } from './places.service';

/** Tourist discovery and detail, backed by `catalog.PlaceQueryService`. */
@Module({
  imports: [CatalogModule],
  controllers: [PlacesController],
  providers: [PlacesService],
})
export class PlacesModule {}
