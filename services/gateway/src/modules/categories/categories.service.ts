import { Injectable } from '@nestjs/common';
import type { RequestContext } from '@wayfare/nest-common';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import { toCategoryResponseDto } from './category.mapper';
import type { CategoryResponseDto } from './dto/category-response.dto';

/** `/categories`, backed by `catalog.PlaceQueryService`. */
@Injectable()
export class CategoriesService {
  constructor(private readonly catalog: CatalogServiceGrpcClient) {}

  async list(context: RequestContext): Promise<CategoryResponseDto[]> {
    const response = await this.catalog.placeQueries.call('listCategories', {}, context);
    return response.categories.map(toCategoryResponseDto);
  }
}
