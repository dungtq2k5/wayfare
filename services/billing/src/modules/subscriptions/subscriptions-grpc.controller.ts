import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { billingGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { SubscriptionsService } from './subscriptions.service';

/** `wayfare.billing.BillingService` — unpack the caller, delegate once. */
@Controller()
@billingGrpc.BillingServiceControllerMethods()
export class SubscriptionsGrpcController implements billingGrpc.BillingServiceController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  getOverview(
    _request: billingGrpc.GetOverviewRequest,
    metadata?: Metadata,
  ): Promise<billingGrpc.GetOverviewResponse> {
    return this.subscriptions.getOverview(unpackCallerContext(metadata));
  }

  listPurchasablePlans(
    _request: billingGrpc.ListPurchasablePlansRequest,
    metadata?: Metadata,
  ): Promise<billingGrpc.ListPurchasablePlansResponse> {
    return this.subscriptions.listPurchasablePlans(unpackCallerContext(metadata));
  }

  createCheckoutSession(
    request: billingGrpc.CreateCheckoutSessionRequest,
    metadata?: Metadata,
  ): Promise<billingGrpc.CreateCheckoutSessionResponse> {
    return this.subscriptions.createCheckoutSession(request, unpackCallerContext(metadata));
  }

  createPortalSession(
    _request: billingGrpc.CreatePortalSessionRequest,
    metadata?: Metadata,
  ): Promise<billingGrpc.CreatePortalSessionResponse> {
    return this.subscriptions.createPortalSession(unpackCallerContext(metadata));
  }

  listInvoices(
    _request: billingGrpc.ListInvoicesRequest,
    metadata?: Metadata,
  ): Promise<billingGrpc.ListInvoicesResponse> {
    return this.subscriptions.listInvoices(unpackCallerContext(metadata));
  }

  getBillingSummary(
    request: billingGrpc.GetBillingSummaryRequest,
  ): Promise<billingGrpc.GetBillingSummaryResponse> {
    return this.subscriptions.getBillingSummary(request);
  }
}
