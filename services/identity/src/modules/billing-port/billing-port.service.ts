import { Injectable } from '@nestjs/common';
import { rpcError } from '@wayfare/nest-common';

/** What billing still owes an owner's buyers (api-endpoints-plan §12.2). */
export interface SellerObligations {
  readonly issuedVoucherCount: number;
  readonly openCheckoutCount: number;
}

/**
 * billing, as identity sees it. Until billing exists every call fails closed (api-endpoints-plan
 * §12.2): deactivating an owner is refused rather than allowed unchecked. Billing's client replaces
 * this provider; the use cases do not change.
 */
@Injectable()
export class BillingPortService {
  /** Live obligations for an owner, read at the moment of deciding. Throws when unavailable. */
  getLiveObligations(_ownerUserId: string): Promise<SellerObligations> {
    return Promise.reject(rpcError('UPSTREAM_UNAVAILABLE'));
  }
}
