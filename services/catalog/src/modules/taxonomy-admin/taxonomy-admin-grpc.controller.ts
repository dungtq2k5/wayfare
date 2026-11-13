import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { TaxonomyAdminService } from './taxonomy-admin.service';

/** `wayfare.catalog.TaxonomyAdminService` — unpack the caller, delegate once. */
@Controller()
@catalogGrpc.TaxonomyAdminServiceControllerMethods()
export class TaxonomyAdminGrpcController implements catalogGrpc.TaxonomyAdminServiceController {
  constructor(private readonly taxonomy: TaxonomyAdminService) {}

  listAdminCategories(
    _request: catalogGrpc.ListAdminCategoriesRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.ListAdminCategoriesResponse> {
    return this.taxonomy.listAdminCategories(unpackCallerContext(metadata));
  }

  createCategory(
    request: catalogGrpc.CreateCategoryRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.CreateCategoryResponse> {
    return this.taxonomy.createCategory(request, unpackCallerContext(metadata));
  }

  updateCategory(
    request: catalogGrpc.UpdateCategoryRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.UpdateCategoryResponse> {
    return this.taxonomy.updateCategory(request, unpackCallerContext(metadata));
  }

  listAdminAreas(
    _request: catalogGrpc.ListAdminAreasRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.ListAdminAreasResponse> {
    return this.taxonomy.listAdminAreas(unpackCallerContext(metadata));
  }

  getAdminArea(
    request: catalogGrpc.GetAdminAreaRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.GetAdminAreaResponse> {
    return this.taxonomy.getAdminArea(request, unpackCallerContext(metadata));
  }

  createArea(
    request: catalogGrpc.CreateAreaRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.CreateAreaResponse> {
    return this.taxonomy.createArea(request, unpackCallerContext(metadata));
  }

  updateArea(
    request: catalogGrpc.UpdateAreaRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.UpdateAreaResponse> {
    return this.taxonomy.updateArea(request, unpackCallerContext(metadata));
  }
}
