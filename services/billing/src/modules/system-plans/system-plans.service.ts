import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { FREE_PLAN_CODE, FREE_PLAN_GRANTS } from '@wayfare/contracts';
import type { PrismaClient } from '../../../generated/prisma/client';
import { grantColumns } from '../entitlements/domain/grants-write';
import { PrismaService } from '../prisma/prisma.service';

const LOCK_KEY = 'billing:system-plans';

/**
 * Inserts `FREE` when no live row has its code (rdm-spec B-1), under an advisory lock. Insert-only:
 * an existing row is an admin's, and its grants are the source of Free's from then on. Returns
 * whether it inserted.
 */
export async function syncSystemPlans(
  prisma: Pick<PrismaClient, '$transaction'>,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`;
    const existing = await tx.plan.findFirst({
      where: { code: FREE_PLAN_CODE, deletedAt: null },
      select: { id: true },
    });
    if (existing !== null) return false;
    await tx.plan.create({
      data: {
        code: FREE_PLAN_CODE,
        name: 'Free',
        sortOrder: 0,
        stripeProductId: null,
        ...grantColumns(FREE_PLAN_GRANTS),
      },
      select: { id: true },
    });
    return true;
  });
}

/** Runs the sync at boot, so no account is ever opened without `FREE`. */
@Injectable()
export class SystemPlansService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SystemPlansService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const inserted = await syncSystemPlans(this.prisma);
    this.logger.log({ inserted }, 'system plans synced');
  }
}
