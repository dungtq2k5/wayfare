import { Injectable } from '@nestjs/common';
import { rpcError } from '@wayfare/nest-common';

/**
 * billing, as catalog sees it. Until billing exists every call fails closed (api-endpoints-plan
 * §12.2): deleting a Venue is refused rather than allowed unchecked. Billing's client replaces this
 * provider; the use cases do not change.
 */
@Injectable()
export class BillingPortService {
  /** Unredeemed vouchers sold for a Place, read at the moment of deciding. Throws when unavailable. */
  countLiveVouchers(_placeId: string): Promise<number> {
    return Promise.reject(rpcError('UPSTREAM_UNAVAILABLE'));
  }
}
