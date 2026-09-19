import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { OwnerPlacesService } from './owner-places.service';

/** `wayfare.catalog.OwnerPlaceService` — unpack the caller, delegate once. */
@Controller()
@catalogGrpc.OwnerPlaceServiceControllerMethods()
export class OwnerPlacesGrpcController implements catalogGrpc.OwnerPlaceServiceController {
  constructor(private readonly ownerPlaces: OwnerPlacesService) {}

  listMyPlaces(
    _request: catalogGrpc.ListMyPlacesRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.ListMyPlacesResponse> {
    return this.ownerPlaces.listMyPlaces(unpackCallerContext(metadata));
  }

  getMyPlace(
    request: catalogGrpc.GetMyPlaceRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.GetMyPlaceResponse> {
    return this.ownerPlaces.getMyPlace(request, unpackCallerContext(metadata));
  }

  getMyLimits(
    _request: catalogGrpc.GetMyLimitsRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.GetMyLimitsResponse> {
    return this.ownerPlaces.getMyLimits(unpackCallerContext(metadata));
  }

  deactivateMyPlace(
    request: catalogGrpc.DeactivateMyPlaceRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.DeactivateMyPlaceResponse> {
    return this.ownerPlaces.deactivateMyPlace(request, unpackCallerContext(metadata));
  }

  reactivateMyPlace(
    request: catalogGrpc.ReactivateMyPlaceRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.ReactivateMyPlaceResponse> {
    return this.ownerPlaces.reactivateMyPlace(request, unpackCallerContext(metadata));
  }
}
