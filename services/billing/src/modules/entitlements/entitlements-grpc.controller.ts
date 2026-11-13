import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { billingGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { EntitlementsService } from './entitlements.service';

/** `wayfare.billing.EntitlementService` — unpack the caller, delegate once. */
@Controller()
@billingGrpc.EntitlementServiceControllerMethods()
export class EntitlementsGrpcController implements billingGrpc.EntitlementServiceController {
  constructor(private readonly entitlements: EntitlementsService) {}

  getEntitlements(
    request: billingGrpc.GetEntitlementsRequest,
    metadata?: Metadata,
  ): Promise<billingGrpc.GetEntitlementsResponse> {
    return this.entitlements.getEntitlements(request, unpackCallerContext(metadata));
  }
}
