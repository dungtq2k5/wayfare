import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

/** `/categories`, backed by `catalog.PlaceQueryService`. */
@Module({
  imports: [CatalogModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
})
export class CategoriesModule {}
