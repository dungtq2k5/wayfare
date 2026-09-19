// pnpm --filter @wayfare/billing seed:dev — the paid plans for a local stack (ADR 0002): Growth and
// Pro at product-overview §8.2's grants, created when missing and never changed afterwards. With a
// sandbox key and the STRIPE_PRICE_* lines `stripe:sandbox-setup` prints, it registers their prices
// through the admin route's own code, reading each amount from Stripe; without a key, it adds local
// `price_dev_*` prices at the product's amounts, so synthetic subscriptions can name one. Never in
// production.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  AnalyticsLevel,
  AuditActorType,
  newId,
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
    /** product-overview §8.2, in cents: the amounts a local price takes without a key. */
    amounts: { MONTH: 900, YEAR: 9000 },
  },
  {
    code: 'PRO',
    name: 'Pro',
    sortOrder: 20,
    grants: PRO,
    prices: { MONTH: 'STRIPE_PRICE_PRO_MONTHLY', YEAR: 'STRIPE_PRICE_PRO_ANNUAL' },
    amounts: { MONTH: 2900, YEAR: 29000 },
  },
] as const;

/**
 * Creates the missing plans and registers their prices: through Stripe with a key, as local
 * `price_dev_*` rows without one. Returns the report lines.
 */
export async function seedDevPlans(
  prisma: PrismaService,
  env: Readonly<Record<string, string | undefined>>,
): Promise<string[]> {
  const key = env.STRIPE_SECRET_KEY || undefined;
  const outbox = new OutboxService();
  const plans = new PlansService(
    prisma,
    outbox,
    new StripePaymentsProvider(key),
    new EntitlementsService(prisma, outbox),
    // Registering a price never counts Places.
    {} as CatalogServiceGrpcClient,
  );
  const lines: string[] = [];
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
      if (key === undefined) {
        // No Stripe to read a price from: a local development price at product §8.2's amount,
        // so synthetic subscription events have a price to name (as the walks do).
        const active = await prisma.planPrice.findFirst({
          where: { planId: row.id, billingInterval: interval, isActive: true },
          select: { id: true },
        });
        if (active !== null) continue;
        const stripePriceId = `price_dev_${plan.code.toLowerCase()}_${interval.toLowerCase()}`;
        await prisma.planPrice.upsert({
          where: { stripePriceId },
          create: {
            id: newId(),
            planId: row.id,
            stripePriceId,
            billingInterval: interval,
            amountMinor: plan.amounts[interval],
            currency: 'USD',
          },
          update: { isActive: true },
          select: { id: true },
        });
        lines.push(`registered ${stripePriceId} locally (no STRIPE_SECRET_KEY)`);
        continue;
      }
      const priceId = env[variable] || undefined;
      if (priceId === undefined) continue;
      const known = await prisma.planPrice.findUnique({ where: { stripePriceId: priceId } });
      if (known !== null) continue;
      await plans.register(row.id, priceId, interval, {
        actor: { type: AuditActorType.SYSTEM },
        origin: { ip: null, userAgent: null },
      });
      lines.push(`registered ${variable}`);
    }
  }
  return lines;
}

async function main(): Promise<void> {
  assertNotProduction(process.env);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('No database URL — copy .env.example to .env');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const lines = await seedDevPlans(prisma as unknown as PrismaService, process.env);
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
