import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { TourQueriesService } from './tour-queries.service';

/** `wayfare.catalog.TourQueryService` — the tourist's tours and their sync. */
@Controller()
@catalogGrpc.TourQueryServiceControllerMethods()
export class TourQueriesGrpcController implements catalogGrpc.TourQueryServiceController {
  constructor(private readonly queries: TourQueriesService) {}

  listTours(request: catalogGrpc.ListToursRequest, metadata?: Metadata) {
    return this.queries.listTours(request, unpackCallerContext(metadata));
  }

  getTour(request: catalogGrpc.GetTourRequest, metadata?: Metadata) {
    return this.queries.getTour(request, unpackCallerContext(metadata));
  }

  getTourByCode(request: catalogGrpc.GetTourByCodeRequest, metadata?: Metadata) {
    return this.queries.getTourByCode(request, unpackCallerContext(metadata));
  }

  syncTours(request: catalogGrpc.SyncToursRequest, metadata?: Metadata) {
    return this.queries.syncTours(request, unpackCallerContext(metadata));
  }
}
