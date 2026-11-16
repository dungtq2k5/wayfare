import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { catalogGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { OfflineService } from './offline.service';

/** `wayfare.catalog.OfflineService` — unpack the caller, delegate once. */
@Controller()
@catalogGrpc.OfflineServiceControllerMethods()
export class OfflineGrpcController implements catalogGrpc.OfflineServiceController {
  constructor(private readonly offline: OfflineService) {}

  getManifest(
    request: catalogGrpc.GetManifestRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.GetManifestResponse> {
    return this.offline.getManifest(request, unpackCallerContext(metadata));
  }

  getManifestDiff(
    request: catalogGrpc.GetManifestDiffRequest,
    metadata?: Metadata,
  ): Promise<catalogGrpc.GetManifestDiffResponse> {
    return this.offline.getManifestDiff(request, unpackCallerContext(metadata));
  }
}
