import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { PlacesService } from './places.service';

/** `wayfare.catalog.PlaceAdminService` — unpack the caller, delegate once. */
@Controller()
@catalogGrpc.PlaceAdminServiceControllerMethods()
export class PlacesGrpcController implements catalogGrpc.PlaceAdminServiceController {
  constructor(private readonly places: PlacesService) {}

  listPlaces(
    request: catalogGrpc.ListPlacesRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.ListPlacesResponse> {
    return this.places.listPlaces(request, unpackCallerContext(metadata));
  }

  getPlaceAdmin(
    request: catalogGrpc.GetPlaceAdminRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.GetPlaceAdminResponse> {
    return this.places.getPlaceAdmin(request, unpackCallerContext(metadata));
  }

  createEditorialPlace(
    request: catalogGrpc.CreateEditorialPlaceRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.CreateEditorialPlaceResponse> {
    return this.places.createEditorialPlace(request, unpackCallerContext(metadata));
  }

  updatePlace(
    request: catalogGrpc.UpdatePlaceRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.UpdatePlaceResponse> {
    return this.places.updatePlace(request, unpackCallerContext(metadata));
  }

  updateEditorial(
    request: catalogGrpc.UpdateEditorialRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.UpdateEditorialResponse> {
    return this.places.updateEditorial(request, unpackCallerContext(metadata));
  }

  replacePhotos(
    request: catalogGrpc.ReplacePhotosRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.ReplacePhotosResponse> {
    return this.places.replacePhotos(request, unpackCallerContext(metadata));
  }

  replaceMenu(
    request: catalogGrpc.ReplaceMenuRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.ReplaceMenuResponse> {
    return this.places.replaceMenu(request, unpackCallerContext(metadata));
  }

  replaceOpeningHours(
    request: catalogGrpc.ReplaceOpeningHoursRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.ReplaceOpeningHoursResponse> {
    return this.places.replaceOpeningHours(request, unpackCallerContext(metadata));
  }

  requestActivation(
    request: catalogGrpc.RequestActivationRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.RequestActivationResponse> {
    return this.places.requestActivation(request, unpackCallerContext(metadata));
  }

  deactivatePlace(
    request: catalogGrpc.DeactivatePlaceRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.DeactivatePlaceResponse> {
    return this.places.deactivatePlace(request, unpackCallerContext(metadata));
  }

  deletePlace(
    request: catalogGrpc.DeletePlaceRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.DeletePlaceResponse> {
    return this.places.deletePlace(request, unpackCallerContext(metadata));
  }

  restorePlace(
    request: catalogGrpc.RestorePlaceRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.RestorePlaceResponse> {
    return this.places.restorePlace(request, unpackCallerContext(metadata));
  }

  getPlaceQr(
    request: catalogGrpc.GetPlaceQrRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.GetPlaceQrResponse> {
    return this.places.getPlaceQr(request, unpackCallerContext(metadata));
  }
}
