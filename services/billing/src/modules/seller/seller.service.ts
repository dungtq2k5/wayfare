import { Injectable } from '@nestjs/common';
import { zUuidV7 } from '@wayfare/contracts';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import { parseRpcRequest, toProtoTimestamp } from '@wayfare/nest-common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { subscriptionBlocker } from './domain/erasure-blockers';

const ownerField = z.object({ ownerUserId: zUuidV7 });
const placeField = z.object({ placeId: zUuidV7 });
const userField = z.object({ userId: zUuidV7 });

/**
 * What billing owes a seller's buyers (api-endpoints-plan §12.2): identity asks before deactivating
 * an owner, catalog before deleting a Venue. Zero until the voucher tables exist — true, because
 * nothing can be sold yet — from the RPCs Phase 3 fills in.
 */
@Injectable()
export class SellerService {
  constructor(private readonly prisma: PrismaService) {}

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

  /**
   * What billing says about erasing an account (api-endpoints-plan §1.3): a subscription that can
   * still charge or a Checkout page still open. Orders, sold vouchers and disputes are zero until
   * their tables exist. A user with no billing account — every tourist and staff member — is clear.
   */
  async getErasureBlockers(
    request: billingGrpc.GetErasureBlockersRequest,
  ): Promise<billingGrpc.GetErasureBlockersResponse> {
    const { userId } = parseRpcRequest(userField, request);
    const account = await this.prisma.billingAccount.findUnique({
      where: { ownerUserId: userId },
      select: {
        subscriptionStatus: true,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: true,
        checkoutOpenUntil: true,
      },
    });
    const blocker = subscriptionBlocker(account, new Date());
    return {
      pendingBuyerOrder: false,
      activeSubscription: blocker.activeSubscription,
      subscriptionEndsAt:
        blocker.subscriptionEndsAt === null
          ? undefined
          : toProtoTimestamp(blocker.subscriptionEndsAt),
      issuedVouchersSold: 0,
      openDisputes: 0,
    };
  }
}
