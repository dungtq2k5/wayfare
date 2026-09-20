import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { narrationGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { HotsetService } from './hotset.service';

/** `wayfare.narration.HotsetService` — unpack the caller, delegate once. */
@Controller()
@narrationGrpc.HotsetServiceControllerMethods()
export class HotsetGrpcController implements narrationGrpc.HotsetServiceController {
  constructor(private readonly warmup: HotsetService) {}

  hotset(
    request: narrationGrpc.HotsetRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.HotsetResponse> {
    return this.warmup.hotset(request, unpackCallerContext(metadata));
  }

  prefetch(
    request: narrationGrpc.PrefetchRequest,
    metadata?: Metadata,
  ): Promise<narrationGrpc.PrefetchResponse> {
    return this.warmup.prefetch(request, unpackCallerContext(metadata));
  }
}
