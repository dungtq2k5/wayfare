import { Injectable, Logger } from '@nestjs/common';
import { rpcError, SYSTEM_ORIGIN } from '@wayfare/nest-common';
import { BillingServiceGrpcClient } from './billing-service-grpc.client';

/** What billing still owes an owner's buyers (api-endpoints-plan §12.2). */
export interface SellerObligations {
  readonly issuedVoucherCount: number;
  readonly openCheckoutCount: number;
}

/**
 * billing, as identity sees it (api-endpoints-plan §12.2). Read at the moment of deciding, and fail
 * closed: an unreachable billing refuses the deactivation rather than allowing it unchecked.
 */
@Injectable()
export class BillingPortService {
  private readonly logger = new Logger(BillingPortService.name);

  constructor(private readonly billing: BillingServiceGrpcClient) {}

  /** Live obligations for an owner. Throws `UPSTREAM_UNAVAILABLE` when billing cannot say. */
  async getLiveObligations(ownerUserId: string): Promise<SellerObligations> {
    try {
      return await this.billing.seller.call(
        'getLiveObligations',
        { ownerUserId },
        { kind: 'anonymous', origin: SYSTEM_ORIGIN },
      );
    } catch (error) {
      this.logger.warn(
        { ownerUserId, kind: error instanceof Error ? error.name : 'unknown' },
        'billing did not answer the live obligations',
      );
      throw rpcError('UPSTREAM_UNAVAILABLE');
    }
  }
}
