// pnpm --filter @wayfare/billing seed:dev — the paid plans for a local stack (ADR 0002): Growth and
// Pro at product-overview §8.2's grants, created when missing and never changed afterwards. With a
// sandbox key and the STRIPE_PRICE_* lines `stripe:sandbox-setup` prints, it registers their prices
// through the admin route's own code, reading each amount from Stripe. Never in production.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  AnalyticsLevel,
  AuditActorType,
  BillingInterval,
  NarrationLanguageScope,
} from '@wayfare/contracts';
import type { Entitlements } from '@wayfare/contracts';
import { OutboxService } from '@wayfare/nest-common';
import { PrismaClient } from '../../generated/prisma/client';
import type { CatalogServiceGrpcClient } from '../../src/modules/catalog/catalog-service-grpc.client';
import { grantColumns } from '../../src/modules/entitlements/domain/grants-write';
import { EntitlementsService } from '../../src/modules/entitlements/entitlements.service';
import { PlansService } from '../../src/modules/plans/plans.service';
import type { PrismaService } from '../../src/modules/prisma/prisma.service';
import { StripePaymentsProvider } from '../../src/providers/payments/stripe.payments-provider';

/** Refuses a production environment: plans there are an admin's. */
export function assertNotProduction(env: Readonly<Record<string, string | undefined>>): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('seed:dev refuses to run with NODE_ENV=production (ADR 0002)');
  }
}

const GROWTH: Entitlements = {
  maxPlaces: 10,
  autoNarration: true,
  narrationLanguageScope: NarrationLanguageScope.LAUNCH,
  maxPhotosPerPlace: 8,
  // "Unlimited" is written as the platform ceiling (rdm-spec B-1).
  maxMenuItemsPerPlace: 200,
  discoveryBoostSlots: 1,
  aiCreditsPerDay: 10,
  analyticsLevel: AnalyticsLevel.BASIC,
  canSellVouchers: true,
  voucherCommissionBps: 1500,
};

const PRO: Entitlements = {
  ...GROWTH,
  maxPlaces: 50,
  narrationLanguageScope: NarrationLanguageScope.EXTENDED,
  discoveryBoostSlots: 5,
  analyticsLevel: AnalyticsLevel.FULL,
  voucherCommissionBps: 1000,
};

/** The development plans, each with the STRIPE_PRICE_* variables naming its prices. */
export const DEV_PLANS = [
  {
    code: 'GROWTH',
    name: 'Growth',
    sortOrder: 10,
    grants: GROWTH,
    prices: { MONTH: 'STRIPE_PRICE_GROWTH_MONTHLY', YEAR: 'STRIPE_PRICE_GROWTH_ANNUAL' },
  },
  {
    code: 'PRO',
    name: 'Pro',
    sortOrder: 20,
    grants: PRO,
    prices: { MONTH: 'STRIPE_PRICE_PRO_MONTHLY', YEAR: 'STRIPE_PRICE_PRO_ANNUAL' },
  },
] as const;

async function main(): Promise<void> {
  assertNotProduction(process.env);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('No database URL — copy .env.example to .env');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const key = process.env.STRIPE_SECRET_KEY || undefined;
  const outbox = new OutboxService();
  const db = prisma as unknown as PrismaService;
  const plans = new PlansService(
    db,
    outbox,
    new StripePaymentsProvider(key),
    new EntitlementsService(db, outbox),
    // Registering a price never counts Places.
    {} as CatalogServiceGrpcClient,
  );
  const lines: string[] = [];
  try {
    for (const plan of DEV_PLANS) {
      let row = await prisma.plan.findFirst({
        where: { code: plan.code, deletedAt: null },
        select: { id: true },
      });
      if (row === null) {
        row = await prisma.plan.create({
          data: {
            code: plan.code,
            name: plan.name,
            sortOrder: plan.sortOrder,
            ...grantColumns(plan.grants),
          },
          select: { id: true },
        });
        lines.push(`created ${plan.code}`);
      } else {
        lines.push(`${plan.code} present`);
      }
      for (const interval of [BillingInterval.MONTH, BillingInterval.YEAR]) {
        const variable = plan.prices[interval];
        const priceId = process.env[variable] || undefined;
        if (priceId === undefined) continue;
        if (key === undefined) {
          lines.push(`skipped ${variable}: no STRIPE_SECRET_KEY to read it with`);
          continue;
        }
        const known = await prisma.planPrice.findUnique({ where: { stripePriceId: priceId } });
        if (known !== null) continue;
        await plans.register(row.id, priceId, interval, {
          actor: { type: AuditActorType.SYSTEM },
          origin: { ip: null, userAgent: null },
        });
        lines.push(`registered ${variable}`);
      }
    }
    console.log(`✓ billing seed:dev — ${lines.join(', ')}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
