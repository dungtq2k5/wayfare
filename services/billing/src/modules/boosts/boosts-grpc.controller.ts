import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { billingGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { BoostsService } from './boosts.service';

/** `wayfare.billing.BoostService` — unpack the caller, delegate once. */
@Controller()
@billingGrpc.BoostServiceControllerMethods()
export class BoostsGrpcController implements billingGrpc.BoostServiceController {
  constructor(private readonly boosts: BoostsService) {}

  getMyBoosts(
    _request: billingGrpc.GetMyBoostsRequest,
    metadata?: Metadata,
  ): Promise<billingGrpc.GetMyBoostsResponse> {
    return this.boosts.getMyBoosts(unpackCallerContext(metadata));
  }

  setMyBoosts(
    request: billingGrpc.SetMyBoostsRequest,
    metadata?: Metadata,
  ): Promise<billingGrpc.SetMyBoostsResponse> {
    return this.boosts.setMyBoosts(request, unpackCallerContext(metadata));
  }

  getPlaceBoost(
    request: billingGrpc.GetPlaceBoostRequest,
  ): Promise<billingGrpc.GetPlaceBoostResponse> {
    return this.boosts.getPlaceBoost(request);
  }
}
