import { Injectable, Logger } from '@nestjs/common';
import type { Entitlements } from '@wayfare/contracts';
import { rpcError, SYSTEM_ORIGIN } from '@wayfare/nest-common';
import { BillingServiceGrpcClient } from './billing-service-grpc.client';
import { toEntitlements } from './entitlement.mapper';

/**
 * billing, as catalog sees it (api-endpoints-plan §12.2). Read at the moment of deciding, and fail
 * closed: an unreachable billing refuses the delete rather than allowing it unchecked.
 */
@Injectable()
export class BillingPortService {
  private readonly logger = new Logger(BillingPortService.name);

  constructor(private readonly billing: BillingServiceGrpcClient) {}

  /** Unredeemed vouchers sold for a Place. Throws `UPSTREAM_UNAVAILABLE` when billing cannot say. */
  async countLiveVouchers(placeId: string): Promise<number> {
    try {
      const response = await this.billing.seller.call(
        'countLiveVouchers',
        { placeId },
        { kind: 'anonymous', origin: SYSTEM_ORIGIN },
      );
      return response.count;
    } catch (error) {
      this.logger.warn(
        { placeId, kind: error instanceof Error ? error.name : 'unknown' },
        'billing did not answer the voucher count',
      );
      throw rpcError('UPSTREAM_UNAVAILABLE');
    }
  }

  /**
   * An owner's effective grants, for a limit check (api-endpoints-plan §12.2): read at the moment
   * of deciding. Throws `ENTITLEMENTS_UNAVAILABLE` when billing cannot say, never a guess.
   */
  async getEntitlements(ownerUserId: string): Promise<Entitlements> {
    try {
      const answer = await this.billing.entitlements.call(
        'getEntitlements',
        { ownerUserId },
        { kind: 'anonymous', origin: SYSTEM_ORIGIN },
      );
      return toEntitlements(answer.entitlements);
    } catch (error) {
      this.logger.warn(
        { ownerUserId, kind: error instanceof Error ? error.name : 'unknown' },
        'billing did not answer the entitlements',
      );
      throw rpcError('ENTITLEMENTS_UNAVAILABLE');
    }
  }
}
