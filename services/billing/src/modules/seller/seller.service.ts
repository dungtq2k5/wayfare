import { Injectable } from '@nestjs/common';
import { zUuidV7 } from '@wayfare/contracts';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import { parseRpcRequest } from '@wayfare/nest-common';
import { z } from 'zod';

const ownerField = z.object({ ownerUserId: zUuidV7 });
const placeField = z.object({ placeId: zUuidV7 });

/**
 * What billing owes a seller's buyers (api-endpoints-plan §12.2): identity asks before deactivating
 * an owner, catalog before deleting a Venue. Zero until the voucher tables exist — true, because
 * nothing can be sold yet — from the RPCs Phase 3 fills in.
 */
@Injectable()
export class SellerService {
  getLiveObligations(
    request: billingGrpc.GetLiveObligationsRequest,
  ): Promise<billingGrpc.GetLiveObligationsResponse> {
    parseRpcRequest(ownerField, request);
    return Promise.resolve({ issuedVoucherCount: 0, openCheckoutCount: 0 });
  }

  countLiveVouchers(
    request: billingGrpc.CountLiveVouchersRequest,
  ): Promise<billingGrpc.CountLiveVouchersResponse> {
    parseRpcRequest(placeField, request);
    return Promise.resolve({ count: 0 });
  }
}
