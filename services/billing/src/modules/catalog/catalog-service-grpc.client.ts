import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { GrpcServiceCaller, SYSTEM_ORIGIN } from '@wayfare/nest-common';

/** Injection token for catalog's gRPC connection. */
export const CATALOG_GRPC = Symbol('CATALOG_GRPC');

/**
 * catalog as billing calls it (api-endpoints-plan §12.2): the owner's counted Venues, for the
 * overview's usage and the plan dry run. Called with a system context; a failure is an answer the
 * caller reports as "not evaluated", never a refusal.
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

  /** The owner's Venues that count against the place limit; null when catalog cannot answer. */
  async countOwnerPlaces(ownerUserId: string): Promise<number | null> {
    try {
      const response = await this.places.call(
        'countOwnerPlaces',
        { ownerUserId },
        { kind: 'anonymous', origin: SYSTEM_ORIGIN },
      );
      return response.count;
    } catch {
      return null;
    }
  }
}
