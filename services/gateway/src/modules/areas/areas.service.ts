import { Injectable } from '@nestjs/common';
import type { RequestContext } from '@wayfare/nest-common';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import { toAreaResponseDto } from './area.mapper';
import type { AreaResponseDto } from './dto/area-response.dto';

/** `/areas`, backed by `catalog.PlaceQueryService`. */
@Injectable()
export class AreasService {
  constructor(private readonly catalog: CatalogServiceGrpcClient) {}

  async list(context: RequestContext): Promise<AreaResponseDto[]> {
    const response = await this.catalog.placeQueries.call('listAreas', {}, context);
    return response.areas.map(toAreaResponseDto);
  }
}
