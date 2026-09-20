import { Injectable } from '@nestjs/common';
import type { OfflineManifest, OfflineManifestDiff } from '@wayfare/contracts';
import type { RequestContext } from '@wayfare/nest-common';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';
import type { ManifestDiffQueryDto, ManifestQueryDto } from './dto/offline.dto';
import { toOfflineManifest, toOfflineManifestDiff } from './offline.mapper';

/** A first manifest in a language generates its places snapshot: seconds, not the default 2 s. */
export const MANIFEST_DEADLINE_MS = 15_000;

/** `/offline/areas/:areaId/manifest[/diff]`, backed by `catalog.OfflineService`. */
@Injectable()
export class OfflineService {
  constructor(private readonly catalog: CatalogServiceGrpcClient) {}

  async manifest(
    context: RequestContext,
    areaId: string,
    query: ManifestQueryDto,
  ): Promise<OfflineManifest> {
    const response = await this.catalog.offline.call(
      'getManifest',
      { areaId, lang: query.lang.tag },
      context,
      { deadlineMs: MANIFEST_DEADLINE_MS },
    );
    return toOfflineManifest(response);
  }

  async diff(
    context: RequestContext,
    areaId: string,
    query: ManifestDiffQueryDto,
  ): Promise<OfflineManifestDiff> {
    const response = await this.catalog.offline.call(
      'getManifestDiff',
      {
        areaId,
        lang: query.lang.tag,
        fromDatasetVersion: query.fromDatasetVersion,
        fromMapPackVersion: query.fromMapPackVersion,
      },
      context,
      { deadlineMs: MANIFEST_DEADLINE_MS },
    );
    return toOfflineManifestDiff(response);
  }
}
