import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { SYSTEM_CATEGORIES } from '@wayfare/contracts';
import type { SystemCategory } from '@wayfare/contracts';
import type { PrismaClient } from '../../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const LOCK_KEY = 'catalog:system-categories';

/**
 * Inserts every missing registry category (rdm-spec C-2), in one transaction under an advisory lock.
 * Insert-only: an existing row — its icon, order, `applies_to` or deactivation — is an admin's, and
 * never changed here. Returns how many rows it inserted.
 */
export async function syncSystemCategories(
  prisma: Pick<PrismaClient, '$transaction'>,
  categories: readonly SystemCategory[] = SYSTEM_CATEGORIES,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`;
    const { count } = await tx.category.createMany({
      data: categories.map((entry) => ({
        code: entry.code,
        appliesTo: entry.appliesTo,
        icon: entry.icon,
        sortOrder: entry.sortOrder,
      })),
      skipDuplicates: true,
    });
    return count;
  });
}

/** Runs the sync at boot, so a code added in a deploy exists before the first request. */
@Injectable()
export class SystemCatalogService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SystemCatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const inserted = await syncSystemCategories(this.prisma);
    this.logger.log({ inserted, categories: SYSTEM_CATEGORIES.length }, 'system categories synced');
  }
}
