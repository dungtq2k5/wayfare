import { Controller } from '@nestjs/common';
import { billingGrpc } from '@wayfare/contracts/grpc';
import { SellerService } from './seller.service';

/** `wayfare.billing.SellerService` — internal reads, delegated once. */
@Controller()
@billingGrpc.SellerServiceControllerMethods()
export class SellerGrpcController implements billingGrpc.SellerServiceController {
  constructor(private readonly seller: SellerService) {}

  getLiveObligations(
    request: billingGrpc.GetLiveObligationsRequest,
  ): Promise<billingGrpc.GetLiveObligationsResponse> {
    return this.seller.getLiveObligations(request);
  }

  countLiveVouchers(
    request: billingGrpc.CountLiveVouchersRequest,
  ): Promise<billingGrpc.CountLiveVouchersResponse> {
    return this.seller.countLiveVouchers(request);
  }

  getErasureBlockers(
    request: billingGrpc.GetErasureBlockersRequest,
  ): Promise<billingGrpc.GetErasureBlockersResponse> {
    return this.seller.getErasureBlockers(request);
  }
}
