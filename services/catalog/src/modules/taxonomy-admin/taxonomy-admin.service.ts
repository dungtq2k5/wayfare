import { Injectable } from '@nestjs/common';
import {
  AuditResourceType,
  newId,
  zAreaCreateInput,
  zAreaUpdateInput,
  zCategoryCreateInput,
  zCategoryUpdateInput,
  zUuidV7,
} from '@wayfare/contracts';
import type { AdminArea } from '@wayfare/contracts';
import { categoryAppliesToProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { parseRpcRequest, requireAccountContext, rpcError } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import { AreasService, isAreaRefusal } from '../areas/areas.service';
import type { AreaWrite } from '../areas/areas.service';
import { CategoriesService } from '../categories/categories.service';
import { toAdminArea, toAdminCategory } from './taxonomy.mapper';

const categoryIdField = z.object({ categoryId: zUuidV7 });
const areaIdField = z.object({ areaId: zUuidV7 });

/** A GeoJSON text as the value zod validates; unparseable text fails the boundary schema. */
const geoJson = (text: string | undefined): unknown => {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

/**
 * `wayfare.catalog.TaxonomyAdminService` (api-endpoints-plan §3.6): categories and areas. The
 * gateway checks `catalog.taxonomy.manage`; this turns the area writes' refusals into errors.
 */
@Injectable()
export class TaxonomyAdminService {
  constructor(
    private readonly categories: CategoriesService,
    private readonly areas: AreasService,
  ) {}

  async listAdminCategories(
    context: RequestContext,
  ): Promise<catalogGrpc.ListAdminCategoriesResponse> {
    requireAccountContext(context);
    return { categories: (await this.categories.listCategories()).map(toAdminCategory) };
  }

  async createCategory(
    request: catalogGrpc.CreateCategoryRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.CreateCategoryResponse> {
    const input = parseRpcRequest(zCategoryCreateInput, {
      code: request.code,
      appliesTo: categoryAppliesToProto.fromProto(request.appliesTo) ?? undefined,
      icon: request.icon,
      sortOrder: request.sortOrder,
    });
    return { category: toAdminCategory(await this.categories.createCategory(context, input)) };
  }

  async updateCategory(
    request: catalogGrpc.UpdateCategoryRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.UpdateCategoryResponse> {
    const { categoryId } = parseRpcRequest(categoryIdField, request);
    const input = parseRpcRequest(zCategoryUpdateInput, {
      appliesTo:
        request.appliesTo === undefined
          ? undefined
          : (categoryAppliesToProto.fromProto(request.appliesTo) ?? 'UNSPECIFIED'),
      icon: request.icon,
      sortOrder: request.sortOrder,
      isActive: request.isActive,
    });
    return {
      category: toAdminCategory(await this.categories.updateCategory(context, categoryId, input)),
    };
  }

  async listAdminAreas(context: RequestContext): Promise<catalogGrpc.ListAdminAreasResponse> {
    requireAccountContext(context);
    return { areas: (await this.areas.adminAreas()).map(toAdminArea) };
  }

  async getAdminArea(
    request: catalogGrpc.GetAdminAreaRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.GetAdminAreaResponse> {
    requireAccountContext(context);
    const { areaId } = parseRpcRequest(areaIdField, request);
    return { area: toAdminArea(await this.area(areaId)) };
  }

  async createArea(
    request: catalogGrpc.CreateAreaRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.CreateAreaResponse> {
    requireAccountContext(context);
    const input = parseRpcRequest(zAreaCreateInput, {
      code: request.code,
      nameVi: request.nameVi,
      boundary: geoJson(request.boundaryGeojson),
      center: request.center,
      defaultZoom: request.defaultZoom,
      sortOrder: request.sortOrder,
      isActive: request.isActive,
    });
    const write = await this.areas.createArea(context, { id: newId(), ...input });
    return { area: toAdminArea(await this.area(this.written(write))) };
  }

  async updateArea(
    request: catalogGrpc.UpdateAreaRequest,
    context: RequestContext,
  ): Promise<catalogGrpc.UpdateAreaResponse> {
    requireAccountContext(context);
    const { areaId } = parseRpcRequest(areaIdField, request);
    const patch = parseRpcRequest(zAreaUpdateInput, {
      nameVi: request.nameVi,
      boundary: geoJson(request.boundaryGeojson),
      center: request.center ?? undefined,
      defaultZoom: request.defaultZoom,
      sortOrder: request.sortOrder,
      isActive: request.isActive,
    });
    const write = await this.areas.updateArea(context, areaId, patch);
    return { area: toAdminArea(await this.area(this.written(write))) };
  }

  private async area(areaId: string): Promise<AdminArea> {
    const [area] = await this.areas.adminAreas(areaId);
    if (area === undefined) {
      throw rpcError('RESOURCE_NOT_FOUND', { resource: AuditResourceType.AREA });
    }
    return area;
  }

  /** The written area's id, or the refusal as its error (api-endpoints-plan §3.6). */
  private written(write: AreaWrite): string {
    if (!isAreaRefusal(write)) return write.id;
    switch (write.outcome) {
      case 'overlaps':
        throw rpcError('AREA_OVERLAPS', { codes: [...write.codes] });
      case 'uncovers':
        throw rpcError('AREA_EXCLUDES_PLACES', {
          count: write.count,
          placeIds: [...write.placeIds],
        });
      case 'has-live-places':
        throw rpcError('AREA_HAS_LIVE_PLACES', { count: write.count });
      case 'invalid':
        throw rpcError('VALIDATION_FAILED', { issues: [{ path: write.path, code: write.code }] });
    }
  }
}
