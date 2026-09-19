import { Injectable } from '@nestjs/common';
import type { AdminArea } from '@wayfare/contracts';
import type { AccountContext } from '@wayfare/nest-common';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import { toAdminArea, toCreateAreaRequest, toUpdateAreaRequest } from './admin-area.mapper';
import type { CreateAreaDto, UpdateAreaDto } from './dto/admin-area.dto';

/** `/admin/areas`, backed by `catalog.TaxonomyAdminService`. */
@Injectable()
export class AdminAreasService {
  constructor(private readonly catalog: CatalogServiceGrpcClient) {}

  async list(context: AccountContext): Promise<AdminArea[]> {
    const response = await this.catalog.taxonomyAdmin.call('listAdminAreas', {}, context);
    return response.areas.map(toAdminArea);
  }

  async get(context: AccountContext, areaId: string): Promise<{ area: AdminArea }> {
    const response = await this.catalog.taxonomyAdmin.call('getAdminArea', { areaId }, context);
    return { area: toAdminArea(response.area) };
  }

  async create(context: AccountContext, body: CreateAreaDto): Promise<{ area: AdminArea }> {
    const response = await this.catalog.taxonomyAdmin.call(
      'createArea',
      toCreateAreaRequest(body),
      context,
    );
    return { area: toAdminArea(response.area) };
  }

  async update(
    context: AccountContext,
    areaId: string,
    body: UpdateAreaDto,
  ): Promise<{ area: AdminArea }> {
    const response = await this.catalog.taxonomyAdmin.call(
      'updateArea',
      toUpdateAreaRequest(areaId, body),
      context,
    );
    return { area: toAdminArea(response.area) };
  }
}
