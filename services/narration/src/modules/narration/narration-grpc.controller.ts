import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { narrationGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { NarrationService } from './narration.service';

/** `wayfare.narration.NarrationService` — unpack the caller, delegate once. */
@Controller()
@narrationGrpc.NarrationServiceControllerMethods()
export class NarrationGrpcController implements narrationGrpc.NarrationServiceController {
  constructor(private readonly narration: NarrationService) {}

  requestOnDemand(
    request: narrationGrpc.RequestOnDemandRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.RequestOnDemandResponse> {
    return this.narration.requestOnDemand(request, unpackCallerContext(metadata));
  }

  getNarrationStatus(
    request: narrationGrpc.GetNarrationStatusRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.GetNarrationStatusResponse> {
    return this.narration.getNarrationStatus(request, unpackCallerContext(metadata));
  }
}
