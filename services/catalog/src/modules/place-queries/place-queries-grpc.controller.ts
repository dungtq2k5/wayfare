import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { PlaceQueriesService } from './place-queries.service';

/** `wayfare.catalog.PlaceQueryService` — the tourist hot path; unpack the caller, delegate once. */
@Controller()
@catalogGrpc.PlaceQueryServiceControllerMethods()
export class PlaceQueriesGrpcController implements catalogGrpc.PlaceQueryServiceController {
  constructor(private readonly queries: PlaceQueriesService) {}

  syncPlaces(
    request: catalogGrpc.SyncPlacesRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.SyncPlacesResponse> {
    return this.queries.syncPlaces(request, unpackCallerContext(metadata));
  }

  nearbyPlaces(
    request: catalogGrpc.NearbyPlacesRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.NearbyPlacesResponse> {
    return this.queries.nearbyPlaces(request, unpackCallerContext(metadata));
  }

  getPlace(
    request: catalogGrpc.GetPlaceRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.GetPlaceResponse> {
    return this.queries.getPlace(request, unpackCallerContext(metadata));
  }

  getPlaceByCode(
    request: catalogGrpc.GetPlaceByCodeRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.GetPlaceByCodeResponse> {
    return this.queries.getPlaceByCode(request, unpackCallerContext(metadata));
  }

  resolvePublicCode(
    request: catalogGrpc.ResolvePublicCodeRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.ResolvePublicCodeResponse> {
    return this.queries.resolvePublicCode(request, unpackCallerContext(metadata));
  }

  listCategories(
    request: catalogGrpc.ListCategoriesRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.ListCategoriesResponse> {
    return this.queries.listCategories(request, unpackCallerContext(metadata));
  }

  listAreas(
    request: catalogGrpc.ListAreasRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.ListAreasResponse> {
    return this.queries.listAreas(request, unpackCallerContext(metadata));
  }
}
