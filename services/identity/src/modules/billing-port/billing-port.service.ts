import { Injectable, Logger } from '@nestjs/common';
import { fromOptionalProtoTimestamp, rpcError, SYSTEM_ORIGIN } from '@wayfare/nest-common';
import { BillingServiceGrpcClient } from './billing-service-grpc.client';

/** What billing still owes an owner's buyers (api-endpoints-plan §12.2). */
export interface SellerObligations {
  readonly issuedVoucherCount: number;
  readonly openCheckoutCount: number;
}

/** What stands in the way of erasing an account (api-endpoints-plan §1.3). */
export interface ErasureBlockers {
  readonly pendingBuyerOrder: boolean;
  readonly activeSubscription: boolean;
  readonly subscriptionEndsAt: Date | null;
  readonly issuedVouchersSold: number;
  readonly openDisputes: number;
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

  /** billing's erasure check, for every account. Throws `UPSTREAM_UNAVAILABLE` when billing cannot say. */
  async getErasureBlockers(userId: string): Promise<ErasureBlockers> {
    try {
      const answer = await this.billing.seller.call(
        'getErasureBlockers',
        { userId },
        { kind: 'anonymous', origin: SYSTEM_ORIGIN },
      );
      return {
        pendingBuyerOrder: answer.pendingBuyerOrder,
        activeSubscription: answer.activeSubscription,
        subscriptionEndsAt: fromOptionalProtoTimestamp(
          answer.subscriptionEndsAt,
          '/subscriptionEndsAt',
        ),
        issuedVouchersSold: answer.issuedVouchersSold,
        openDisputes: answer.openDisputes,
      };
    } catch (error) {
      this.logger.warn(
        { userId, kind: error instanceof Error ? error.name : 'unknown' },
        'billing did not answer the erasure check',
      );
      throw rpcError('UPSTREAM_UNAVAILABLE');
    }
  }
}
