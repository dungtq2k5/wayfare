import { Injectable } from '@nestjs/common';
import { ETaggedResult, WithMeta } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import type { SyncPlacesResponseDto } from './dto/sync-response.dto';
import type { SyncPlacesQueryDto } from './dto/sync.dto';
import { toSyncPlacesResponseDto } from './sync.mapper';

/** `/sync/places`, backed by `catalog.PlaceQueryService`. */
@Injectable()
export class SyncService {
  constructor(private readonly catalog: CatalogServiceGrpcClient) {}

  /** One page, tagged `"<areaId>:<lang>:<datasetVersion>"` (api-endpoints-plan §0.7). */
  async places(
    context: RequestContext,
    query: SyncPlacesQueryDto,
  ): Promise<ETaggedResult<WithMeta<SyncPlacesResponseDto>>> {
    const response = await this.catalog.placeQueries.call(
      'syncPlaces',
      { areaId: query.areaId, lang: query.lang.tag, since: query.since ?? '0' },
      context,
    );
    const page = toSyncPlacesResponseDto(response);
    return ETaggedResult.of(
      WithMeta.of(page, { complete: response.complete }),
      `${query.areaId}:${query.lang.tag}:${page.datasetVersion}`,
    );
  }
}
