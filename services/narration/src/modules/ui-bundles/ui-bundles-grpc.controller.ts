import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { narrationGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { UiBundlesService } from './ui-bundles.service';

/** `wayfare.narration.UiBundleService` — public; unpack the caller, delegate once. */
@Controller()
@narrationGrpc.UiBundleServiceControllerMethods()
export class UiBundlesGrpcController implements narrationGrpc.UiBundleServiceController {
  constructor(private readonly bundles: UiBundlesService) {}

  getBundle(
    request: narrationGrpc.GetBundleRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.GetBundleResponse> {
    return this.bundles.getBundle(request, unpackCallerContext(metadata));
  }
}
