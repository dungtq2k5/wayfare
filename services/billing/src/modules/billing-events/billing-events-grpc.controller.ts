import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { billingGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { BillingEventsService } from './billing-events.service';

/** `wayfare.billing.BillingEventAdminService` — unpack the caller, delegate once. */
@Controller()
@billingGrpc.BillingEventAdminServiceControllerMethods()
export class BillingEventsGrpcController implements billingGrpc.BillingEventAdminServiceController {
  constructor(private readonly events: BillingEventsService) {}

  listBillingEvents(
    request: billingGrpc.ListBillingEventsRequest,
    metadata?: Metadata,
  ): Promise<billingGrpc.ListBillingEventsResponse> {
    return this.events.listBillingEvents(request, unpackCallerContext(metadata));
  }

  replayBillingEvent(
    request: billingGrpc.ReplayBillingEventRequest,
    metadata?: Metadata,
  ): Promise<billingGrpc.ReplayBillingEventResponse> {
    return this.events.replayBillingEvent(request, unpackCallerContext(metadata));
  }
}
