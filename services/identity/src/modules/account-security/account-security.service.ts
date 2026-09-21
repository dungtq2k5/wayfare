import { Injectable } from '@nestjs/common';
import { ActionTokenPurpose, zUuidV7 } from '@wayfare/contracts';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { parseRpcRequest, toProtoTimestamp } from '@wayfare/nest-common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';

const userIdField = z.object({ userId: zUuidV7 });

/**
 * What billing reads before letting an owner move money (api-endpoints-plan §12.2, ADR 0052): a
 * live email-change revert could still undo the address, and a recent credential change starts the
 * payout cooldown. It is always answered live — a cached "no restriction" is exactly the window a
 * takeover uses — and an unknown account answers with neither, which restricts nothing.
 */
@Injectable()
export class AccountSecurityService {
  constructor(private readonly prisma: PrismaService) {}

  async getSecurityState(
    request: identityGrpc.GetSecurityStateRequest,
  ): Promise<identityGrpc.GetSecurityStateResponse> {
    const { userId } = parseRpcRequest(userIdField, request);
    const now = new Date();
    const [user, revert] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { credentialsChangedAt: true },
      }),
      this.prisma.actionToken.findFirst({
        where: {
          userId,
          purpose: ActionTokenPurpose.EMAIL_CHANGE_REVERT,
          usedAt: null,
          invalidatedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { expiresAt: 'desc' },
        select: { expiresAt: true },
      }),
    ]);
    return {
      revertPendingUntil: revert === null ? undefined : toProtoTimestamp(revert.expiresAt),
      credentialsChangedAt:
        user?.credentialsChangedAt == null
          ? undefined
          : toProtoTimestamp(user.credentialsChangedAt),
    };
  }
}
