import { Injectable, Logger } from '@nestjs/common';
import { rpcError, SYSTEM_ORIGIN } from '@wayfare/nest-common';
import { BillingServiceGrpcClient } from './billing-service-grpc.client';

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
}
