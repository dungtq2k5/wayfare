import { Injectable } from '@nestjs/common';
import { canonicalPublicCode, CodeTargetType } from '@wayfare/contracts';
import type { CodeTarget } from '@wayfare/contracts';
import { codeTargetTypeProto } from '@wayfare/contracts/grpc';
import { AppHttpException } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { CatalogServiceGrpcClient } from '../catalog/catalog-service-grpc.client';

/** `GET /codes/:publicCode`, backed by `catalog.PlaceQueryService.ResolvePublicCode`. */
@Injectable()
export class CodesService {
  constructor(private readonly catalog: CatalogServiceGrpcClient) {}

  /** What a code names, in the one code space of Places and tours; a scan is not counted. */
  async resolve(context: RequestContext, code: string): Promise<CodeTarget> {
    const canonical = canonicalPublicCode(code);
    const response =
      canonical === null
        ? null
        : await this.catalog.placeQueries.call(
            'resolvePublicCode',
            { publicCode: canonical, countScan: false },
            context,
          );
    const type =
      response?.exists === true ? codeTargetTypeProto.fromProto(response.targetType) : null;
    if (canonical === null || response === null || type === null) {
      throw new AppHttpException('RESOURCE_NOT_FOUND', { resource: 'CODE' });
    }
    return { type: type satisfies CodeTargetType, id: response.targetId, publicCode: canonical };
  }
}
