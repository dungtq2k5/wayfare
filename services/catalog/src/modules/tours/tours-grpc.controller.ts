import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { ToursService } from './tours.service';

/** `wayfare.catalog.TourAdminService` — unpack the caller, delegate once. */
@Controller()
@catalogGrpc.TourAdminServiceControllerMethods()
export class ToursGrpcController implements catalogGrpc.TourAdminServiceController {
  constructor(private readonly tours: ToursService) {}

  listTours(request: catalogGrpc.TourAdminServiceListToursRequest, metadata?: Metadata) {
    return this.tours.listTours(request, unpackCallerContext(metadata));
  }

  getTourAdmin(request: catalogGrpc.GetTourAdminRequest, metadata?: Metadata) {
    return this.tours.getTourAdmin(request, unpackCallerContext(metadata));
  }

  createTour(request: catalogGrpc.CreateTourRequest, metadata?: Metadata) {
    return this.tours.createTour(request, unpackCallerContext(metadata));
  }

  updateTour(request: catalogGrpc.UpdateTourRequest, metadata?: Metadata) {
    return this.tours.updateTour(request, unpackCallerContext(metadata));
  }

  replaceTourStops(request: catalogGrpc.ReplaceTourStopsRequest, metadata?: Metadata) {
    return this.tours.replaceTourStops(request, unpackCallerContext(metadata));
  }

  requestTourActivation(request: catalogGrpc.RequestTourActivationRequest, metadata?: Metadata) {
    return this.tours.requestTourActivation(request, unpackCallerContext(metadata));
  }

  deactivateTour(request: catalogGrpc.DeactivateTourRequest, metadata?: Metadata) {
    return this.tours.deactivateTour(request, unpackCallerContext(metadata));
  }

  deleteTour(request: catalogGrpc.DeleteTourRequest, metadata?: Metadata) {
    return this.tours.deleteTour(request, unpackCallerContext(metadata));
  }

  restoreTour(request: catalogGrpc.RestoreTourRequest, metadata?: Metadata) {
    return this.tours.restoreTour(request, unpackCallerContext(metadata));
  }

  getTourQr(request: catalogGrpc.GetTourQrRequest, metadata?: Metadata) {
    return this.tours.getTourQr(request, unpackCallerContext(metadata));
  }
}
