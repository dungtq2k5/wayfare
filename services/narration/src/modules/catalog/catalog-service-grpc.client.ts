import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import type { LocalizationTargetType } from '@wayfare/contracts';
import { catalogGrpc, localizationTargetTypeProto } from '@wayfare/contracts/grpc';
import { GrpcServiceCaller, SYSTEM_ORIGIN } from '@wayfare/nest-common';

/** How long a read of catalog's source may take. */
const SOURCE_DEADLINE_MS = 5_000;

/** Injection token for catalog's gRPC connection. */
export const CATALOG_GRPC = Symbol('CATALOG_GRPC');

/**
 * catalog as narration calls it (api-endpoints-plan §12.2): an internal RPC, called with a system
 * context — consumers and the pipeline have no request. Returns proto types only.
 */
@Injectable()
export class CatalogServiceGrpcClient implements OnModuleInit {
  readonly places: GrpcServiceCaller<catalogGrpc.PlaceServiceClient>;

  constructor(@Inject(CATALOG_GRPC) grpc: ClientGrpc) {
    this.places = new GrpcServiceCaller(grpc, catalogGrpc.PLACE_SERVICE_NAME);
  }

  onModuleInit(): void {
    this.places.init();
  }

  /**
   * The target's source text as it is now (api-endpoints-plan §12.2). A transport error rejects,
   * and is retried by the caller; `notFound` is an answer.
   */
  localizationSource(
    targetType: LocalizationTargetType,
    targetId: string,
  ): Promise<catalogGrpc.GetLocalizationSourceResponse> {
    return this.places.call(
      'getLocalizationSource',
      { targetType: localizationTargetTypeProto.toProto(targetType), targetId },
      { kind: 'anonymous', origin: SYSTEM_ORIGIN },
      { deadlineMs: SOURCE_DEADLINE_MS },
    );
  }
}
