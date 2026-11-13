import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { MapPacksService } from './map-packs.service';

/** `wayfare.catalog.MapPackAdminService` — unpack the caller, delegate once. */
@Controller()
@catalogGrpc.MapPackAdminServiceControllerMethods()
export class MapPacksGrpcController implements catalogGrpc.MapPackAdminServiceController {
  constructor(private readonly mapPacks: MapPacksService) {}

  listMapPacks(
    request: catalogGrpc.ListMapPacksRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.ListMapPacksResponse> {
    return this.mapPacks.listMapPacks(request, unpackCallerContext(metadata));
  }

  registerMapPack(
    request: catalogGrpc.RegisterMapPackRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.RegisterMapPackResponse> {
    return this.mapPacks.registerMapPack(request, unpackCallerContext(metadata));
  }

  publishMapPack(
    request: catalogGrpc.PublishMapPackRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.PublishMapPackResponse> {
    return this.mapPacks.publishMapPack(request, unpackCallerContext(metadata));
  }
}
