import { BillingInterval, CurrencyCode, parseEnum } from '@wayfare/contracts';
import { billingIntervalProto } from '@wayfare/contracts/grpc';
import type { billingGrpc } from '@wayfare/contracts/grpc';
import type { Prisma } from '../../../generated/prisma/client';
import { grantsOf } from '../entitlements/domain/grants-write';
import { PLAN_GRANTS_SELECT, toEntitlements } from '../entitlements/entitlement.mapper';

/** A registered price's columns (rdm-spec B-2). */
export const PLAN_PRICE_SELECT = {
  id: true,
  stripePriceId: true,
  billingInterval: true,
  amountMinor: true,
  currency: true,
  isActive: true,
} as const satisfies Prisma.PlanPriceSelect;

/** A price as `PLAN_PRICE_SELECT` loads it. */
export type PlanPriceRow = Prisma.PlanPriceGetPayload<{ select: typeof PLAN_PRICE_SELECT }>;

/** A plan with its grants and prices, active or not (rdm-spec B-1, B-2). */
export const ADMIN_PLAN_SELECT = {
  id: true,
  code: true,
  name: true,
  stripeProductId: true,
  isActive: true,
  sortOrder: true,
  ...PLAN_GRANTS_SELECT,
  prices: { select: PLAN_PRICE_SELECT, orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }] },
} as const satisfies Prisma.PlanSelect;

/** A plan as `ADMIN_PLAN_SELECT` loads it. */
export type AdminPlanRow = Prisma.PlanGetPayload<{ select: typeof ADMIN_PLAN_SELECT }>;

/** A price on the wire. */
export function toPlanPrice(row: PlanPriceRow): billingGrpc.PlanPrice {
  return {
    id: row.id,
    stripePriceId: row.stripePriceId,
    billingInterval: billingIntervalProto.toProto(parseEnum(BillingInterval, row.billingInterval)),
    amountMinor: row.amountMinor,
    currency: parseEnum(CurrencyCode, row.currency),
    isActive: row.isActive,
  };
}

/** A purchasable plan: its active prices only. */
export function toPlan(row: AdminPlanRow): billingGrpc.Plan {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    grants: toEntitlements(grantsOf(row)),
    prices: row.prices.filter((price) => price.isActive).map(toPlanPrice),
  };
}

/** A catalogue plan with every price and its subscriber count. */
export function toAdminPlan(row: AdminPlanRow, subscriberCount: number): billingGrpc.AdminPlan {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    ...(row.stripeProductId === null ? {} : { stripeProductId: row.stripeProductId }),
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    grants: toEntitlements(grantsOf(row)),
    prices: row.prices.map(toPlanPrice),
    subscriberCount,
  };
}
