import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';

/** `/me/favorites` (api-endpoints-plan §2.3). */
@Module({
  imports: [CatalogModule],
  controllers: [FavoritesController],
  providers: [FavoritesService],
})
export class FavoritesModule {}
