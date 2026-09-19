import { Injectable } from '@nestjs/common';
import type { AdminCategory } from '@wayfare/contracts';
import type { AccountContext } from '@wayfare/nest-common';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import {
  toAdminCategory,
  toCreateCategoryRequest,
  toUpdateCategoryRequest,
} from './admin-category.mapper';
import type { CreateCategoryDto, UpdateCategoryDto } from './dto/admin-category.dto';

/** `/admin/categories`, backed by `catalog.TaxonomyAdminService`. */
@Injectable()
export class AdminCategoriesService {
  constructor(private readonly catalog: CatalogServiceGrpcClient) {}

  async list(context: AccountContext): Promise<AdminCategory[]> {
    const response = await this.catalog.taxonomyAdmin.call('listAdminCategories', {}, context);
    return response.categories.map(toAdminCategory);
  }

  async create(
    context: AccountContext,
    body: CreateCategoryDto,
  ): Promise<{ category: AdminCategory }> {
    const response = await this.catalog.taxonomyAdmin.call(
      'createCategory',
      toCreateCategoryRequest(body),
      context,
    );
    return { category: toAdminCategory(response.category) };
  }

  async update(
    context: AccountContext,
    categoryId: string,
    body: UpdateCategoryDto,
  ): Promise<{ category: AdminCategory }> {
    const response = await this.catalog.taxonomyAdmin.call(
      'updateCategory',
      toUpdateCategoryRequest(categoryId, body),
      context,
    );
    return { category: toAdminCategory(response.category) };
  }
}
